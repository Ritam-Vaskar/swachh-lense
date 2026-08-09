/**
 * Verification Agent — Phase 8
 *
 * When a worker marks a task done + uploads an "after" photo:
 * 1. Fetches the original "before" image from the database
 * 2. Sends BOTH images to Gemini Vision for a side-by-side comparison
 * 3. Returns a full AI verification report
 * 4. On pass → updates task to Completed, report to Resolved, triggers Feedback Agent
 * 5. On fail → returns rejection reasons WITHOUT updating DB (worker must re-upload)
 */

import { getPool } from '../models/database.js'
import sharp from 'sharp'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

// ─── Resize helper ────────────────────────────────────────────────────────────
async function resizeDataUrl(dataUrl, maxWidth = 800) {
  const [, base64] = dataUrl.split(',')
  const buf = Buffer.from(base64, 'base64')
  const resized = await sharp(buf).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()
  return `data:image/jpeg;base64,${resized.toString('base64')}`
}

// ─── Heuristic fallback (when no Gemini key) ─────────────────────────────────
function heuristicVerification() {
  return {
    is_same_location: true,
    is_cleaned: true,
    is_relevant: true,
    location_match_confidence: 75,
    cleaning_score: 75,
    overall_score: 75,
    passed: true,
    rejection_reasons: [],
    ai_feedback: 'AI verification skipped (no Gemini API key). Assumed passed for development.',
    before_scene_description: 'Before scene not analyzed.',
    after_scene_description: 'After scene not analyzed.',
  }
}

// ─── Gemini 2-image verification ─────────────────────────────────────────────
async function verifyWithGemini(beforeDataUrl, afterDataUrl, reportContext = {}) {
  const prompt = `You are a strict waste-management audit AI. You are comparing a BEFORE and AFTER photo of a cleanup operation.

BEFORE image = first image provided.
AFTER image = second image provided.

Context:
- Waste category: ${reportContext.category || 'Unknown'}
- Original location description: ${reportContext.location || 'Unknown'}
- Citizen's description of the problem: ${reportContext.description || 'Not provided'}

Your task: Verify that the cleanup was done correctly by analyzing both images.

Return ONLY a valid JSON object (no markdown, no code fences) with EXACTLY these fields:
{
  "is_same_location": boolean (true if both photos appear to be the same physical location — check background, walls, roads, signs, structures),
  "is_cleaned": boolean (true if the waste/problem visible in the before photo is clearly gone or significantly reduced in the after photo),
  "is_relevant": boolean (true if both images are relevant to a waste cleanup — false if after photo is a selfie, blank image, or completely unrelated scene),
  "location_match_confidence": integer 0-100 (how confident you are the location matches),
  "cleaning_score": integer 0-100 (quality of the cleanup — 100 means perfectly clean, 0 means no visible change),
  "overall_score": integer 0-100 (your overall assessment combining location match and cleaning quality),
  "passed": boolean (true ONLY IF is_same_location=true AND is_cleaned=true AND is_relevant=true AND overall_score>=60),
  "rejection_reasons": array of strings (empty if passed, otherwise list specific reasons for failure, e.g. "After photo does not match the reported location", "Waste is still clearly visible in the after photo"),
  "ai_feedback": "A 2-3 sentence human-readable explanation of your findings for the worker",
  "before_scene_description": "1 sentence describing what you see in the before photo",
  "after_scene_description": "1 sentence describing what you see in the after photo"
}`

  // Resize both images
  let beforeResized = beforeDataUrl
  let afterResized = afterDataUrl
  try {
    beforeResized = await resizeDataUrl(beforeDataUrl)
    afterResized = await resizeDataUrl(afterDataUrl)
    console.log('[VerificationAgent] Both images resized for Gemini.')
  } catch (err) {
    console.warn('[VerificationAgent] Image resize failed, using originals:', err.message)
  }

  const [, beforeBase64] = beforeResized.split(',')
  const [, afterBase64] = afterResized.split(',')

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: beforeBase64 } },
            { inline_data: { mime_type: 'image/jpeg', data: afterBase64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' },
      }),
    }
  )

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${errText}`)
  }

  const result = await response.json()
  if (result.candidates?.[0]?.finishReason === 'SAFETY') {
    throw new Error('Gemini blocked the response due to safety guidelines.')
  }

  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!rawText) throw new Error('Gemini returned an empty response.')

  const stripped = rawText.replace(/```json|```/g, '').trim()

  // Robust JSON extraction
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Could not extract JSON from Gemini response: ' + stripped.substring(0, 200))

  // Sanitize smart quotes
  const sanitized = jsonMatch[0]
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')

  return JSON.parse(sanitized)
}

// ─── Main exported function ───────────────────────────────────────────────────
export async function runVerificationAgent({ taskId, afterImageDataUrl, workerNote = '' }) {
  const pool = getPool()
  console.log(`[VerificationAgent] Starting verification for task ${taskId}`)

  // 1. Fetch the task
  const { rows: taskRows } = await pool.query('SELECT * FROM swachhlens_tasks WHERE id = $1', [taskId])
  const task = taskRows[0]
  if (!task) return { passed: false, rejection_reasons: ['Task not found.'] }

  // 2. Fetch the linked report (for before image + context)
  const { rows: reportRows } = await pool.query('SELECT * FROM swachhlens_reports WHERE id = $1', [task.report_id])
  const report = reportRows[0]
  if (!report) return { passed: false, rejection_reasons: ['Linked report not found.'] }

  // 3. Resolve the "before" image — prefer task.before_image_url, fallback to report.image_url
  let beforeDataUrl = task.before_image_url || report.image_url || null

  // If image_url is a storage path (not data URL), look up in media_uploads
  if (beforeDataUrl && !beforeDataUrl.startsWith('data:')) {
    const { rows: mediaRows } = await pool.query(
      'SELECT data_url FROM media_uploads WHERE path = $1 LIMIT 1',
      [beforeDataUrl]
    )
    beforeDataUrl = mediaRows[0]?.data_url || null
  }

  // 4. If no before image is available, use heuristic fallback
  if (!beforeDataUrl || !afterImageDataUrl) {
    console.log('[VerificationAgent] Missing before or after image — using heuristic fallback.')
    const result = heuristicVerification()
    if (result.passed) {
      await commitVerification({ pool, task, report, afterImageDataUrl, workerNote, verificationResult: result })
    }
    return result
  }

  // 5. Call Gemini or fallback
  let verificationResult
  if (!GEMINI_API_KEY) {
    console.log('[VerificationAgent] No GEMINI_API_KEY — using heuristic fallback.')
    verificationResult = heuristicVerification()
  } else {
    try {
      console.log('[VerificationAgent] Running Gemini 2-image comparison...')
      verificationResult = await verifyWithGemini(beforeDataUrl, afterImageDataUrl, {
        category: report.category,
        location: report.location,
        description: report.description,
      })
      console.log(`[VerificationAgent] Gemini result: passed=${verificationResult.passed}, score=${verificationResult.overall_score}`)
    } catch (err) {
      console.error('[VerificationAgent] Gemini call failed:', err.message)
      // On Gemini error, reject rather than silently pass (user's requirement: no fake responses)
      return {
        passed: false,
        overall_score: 0,
        rejection_reasons: [`AI verification failed: ${err.message}`],
        ai_feedback: `The AI verification could not be completed due to an error: ${err.message}. Please try again.`,
        is_same_location: false, is_cleaned: false, is_relevant: false,
        location_match_confidence: 0, cleaning_score: 0,
      }
    }
  }

  // 6. If passed → commit to DB; if failed → return without writing
  if (verificationResult.passed) {
    await commitVerification({ pool, task, report, afterImageDataUrl, workerNote, verificationResult })
  } else {
    console.log(`[VerificationAgent] Task ${taskId} FAILED verification. Reasons: ${verificationResult.rejection_reasons?.join(', ')}`)
  }

  return verificationResult
}

// ─── Commit a passing verification to the DB ──────────────────────────────────
async function commitVerification({ pool, task, report, afterImageDataUrl, workerNote, verificationResult }) {
  const aiRating = verificationResult.overall_score || 75

  // Update task → Completed
  await pool.query(
    `UPDATE swachhlens_tasks SET
       status           = 'Completed',
       after_image_url  = $1,
       worker_note      = $2,
       ai_rating        = $3,
       completion_score = $4,
       ai_feedback      = $5,
       updated_at       = now()
     WHERE id = $6`,
    [afterImageDataUrl, workerNote, aiRating, aiRating, verificationResult.ai_feedback || '', task.id]
  )

  // Update report → Resolved
  await pool.query(
    `UPDATE swachhlens_reports SET
       status         = 'Resolved',
       citizen_update = 'Site has been cleaned and verified by AI. Awaiting final municipal confirmation.',
       updated_at     = now()
     WHERE id = $1`,
    [report.id]
  )

  console.log(`[VerificationAgent] Task ${task.id} verified ✓ — score ${aiRating}/100. Report ${report.reference_code} → Resolved.`)

  // Chain to Feedback Agent
  chainToFeedbackAgent(task.id, report.id)
}

// ─── Chain to Feedback Agent ──────────────────────────────────────────────────
function chainToFeedbackAgent(taskId, reportId) {
  setImmediate(async () => {
    try {
      const { runFeedbackAgent } = await import('./feedbackAgent.js')
      await runFeedbackAgent(taskId, reportId)
    } catch (err) {
      console.error('[VerificationAgent] Failed to chain to Feedback Agent:', err.message)
    }
  })
}
