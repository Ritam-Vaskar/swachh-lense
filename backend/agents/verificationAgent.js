/**
 * Verification Agent
 *
 * Compares a worker's "after" cleanup photo against the original citizen
 * "before" photo using the Gemini Vision API.
 *
 * Entry point: runVerificationAgent({ taskId, afterImageDataUrl, workerNote })
 *
 * CRITICAL RULES:
 *  - Gemini Vision API is the ONLY verification source. No fallback.
 *  - If GEMINI_API_KEY is missing → throw, do NOT pass.
 *  - If Gemini errors → throw, do NOT pass.
 *  - The backend re-derives `passed` from the four criteria. Gemini's own
 *    `passed` field is ignored (it is only used for logging).
 *  - DB is only updated when the backend-derived `passed === true`.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { getPool } from '../models/database.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-2.0-flash'
const PASS_THRESHOLD = 60

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/**
 * Parse a data URL into { mimeType, base64Data }.
 * Supports image/jpeg, image/png, image/webp, image/gif.
 * Throws if the string is not a valid image data URL.
 */
function parseImageDataUrl(dataUrl, label = 'image') {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error(`${label}: not a valid data URL (must start with "data:").`)
  }
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex === -1) throw new Error(`${label}: data URL has no comma separator.`)

  const header = dataUrl.slice(0, commaIndex) // e.g. "data:image/jpeg;base64"
  const base64Data = dataUrl.slice(commaIndex + 1)

  if (!base64Data) throw new Error(`${label}: data URL has empty payload.`)

  // Extract MIME type — e.g. "image/jpeg"
  const mimeMatch = header.match(/^data:([^;]+)/)
  if (!mimeMatch) throw new Error(`${label}: could not extract MIME type from data URL.`)

  const mimeType = mimeMatch[1].toLowerCase()
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
  if (!allowed.includes(mimeType)) {
    throw new Error(`${label}: unsupported MIME type "${mimeType}". Allowed: ${allowed.join(', ')}.`)
  }

  // Normalise image/jpg → image/jpeg
  const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType

  return { mimeType: normalizedMime, base64Data }
}

// ---------------------------------------------------------------------------
// Gemini API call
// ---------------------------------------------------------------------------

const VERIFICATION_PROMPT = `You are an AI municipal waste-management verification auditor.

You will receive exactly two images:

IMAGE 1 = BEFORE photo (the original citizen complaint photo showing the waste/problem)
IMAGE 2 = AFTER photo (the cleanup worker's completion photo)

Your job is to determine whether the AFTER photo proves that the cleanup task represented by the BEFORE photo was properly completed.

Compare the two images carefully.

Evaluate:

1. SAME LOCATION
Determine whether the after image represents the same physical location/scene as the before image.
Use visual evidence such as: buildings, roads, walls, poles, trees, bins, landmarks, street layout, fixed objects, camera perspective, surrounding environment.
Do not require the images to have identical camera angles.

2. CLEANING COMPLETED
Determine whether the waste/problem visible in the before image has actually been cleaned or substantially resolved in the after image.
Do not mark the task as cleaned simply because:
- the image is different
- the waste is outside the frame
- the camera is pointed somewhere else
- the image quality is poor
- the photo is unrelated

3. PHOTO RELEVANCE
Determine whether the after image is actually relevant to the cleanup task.
Reject: selfies, unrelated locations, random objects, screenshots, indoor images when the task is outdoors, images that do not provide evidence of the cleanup.

4. SCORE
Give:
- location_match_confidence: 0-100
- cleaning_score: 0-100
- overall_score: 0-100

5. DECISION
The verification should pass ONLY when ALL of these are true:
- is_same_location === true
- is_cleaned === true
- is_relevant === true
- overall_score >= 60

If any condition fails, passed must be false.

Provide clear rejection reasons whenever verification fails.

Return ONLY valid JSON. Use exactly this structure:

{
  "is_same_location": true,
  "is_cleaned": true,
  "is_relevant": true,
  "location_match_confidence": 92,
  "cleaning_score": 88,
  "overall_score": 85,
  "passed": true,
  "rejection_reasons": [],
  "ai_feedback": "Clear explanation of the comparison and verification decision.",
  "before_scene_description": "Description of the before scene.",
  "after_scene_description": "Description of the after scene."
}

Do not return Markdown. Do not wrap the JSON in \`\`\`json. Do not add any text outside the JSON.`

/**
 * Call Gemini Vision API with both images.
 * Returns the raw parsed JSON from Gemini (not yet validated).
 */
async function callGeminiVerification(beforeImage, afterImage) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set. Verification cannot proceed.')
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  })

  const beforePart = {
    inlineData: {
      mimeType: beforeImage.mimeType,
      data: beforeImage.base64Data,
    },
  }

  const afterPart = {
    inlineData: {
      mimeType: afterImage.mimeType,
      data: afterImage.base64Data,
    },
  }

  let result
  let retries = 0
  const maxRetries = 2

  while (retries <= maxRetries) {
    try {
      console.log(`[VerificationAgent] Calling Gemini SDK (${GEMINI_MODEL}) with before+after images… (attempt ${retries + 1})`)
      result = await model.generateContent([beforePart, afterPart, VERIFICATION_PROMPT])
      break
    } catch (err) {
      if ((err.status === 429 || String(err.message).includes('429')) && retries < maxRetries) {
        console.warn(`[VerificationAgent] Gemini rate limited (HTTP 429). Retrying in 5 seconds...`)
        await new Promise((r) => setTimeout(r, 5000))
        retries++
        continue
      }
      throw err
    }
  }

  const response = result.response
  const rawText = response.text()
  if (!rawText) {
    throw new Error('Gemini returned an empty response.')
  }

  // Strip any accidental markdown fences
  const stripped = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  // Sanitise smart quotes and special chars that break JSON.parse
  const sanitized = stripped
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2026]/g, '...')

  let parsed
  try {
    parsed = JSON.parse(sanitized)
  } catch (err) {
    console.error('[VerificationAgent] JSON parse failed. Raw Gemini output (first 800 chars):', rawText.slice(0, 800))
    throw new Error(`Gemini returned unparseable JSON: ${err.message}`)
  }

  return parsed
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

/**
 * Validate that all required fields exist with correct types/ranges.
 * Throws a descriptive error if any field is missing or invalid.
 */
function validateGeminiResponse(r) {
  const requiredBooleans = ['is_same_location', 'is_cleaned', 'is_relevant', 'passed']
  const requiredNumbers = ['location_match_confidence', 'cleaning_score', 'overall_score']
  const requiredStrings = ['ai_feedback', 'before_scene_description', 'after_scene_description']

  const missing = []
  const invalid = []

  for (const key of requiredBooleans) {
    if (!(key in r)) { missing.push(key); continue }
    if (typeof r[key] !== 'boolean') invalid.push(`${key} must be boolean, got ${typeof r[key]}`)
  }

  for (const key of requiredNumbers) {
    if (!(key in r)) { missing.push(key); continue }
    if (typeof r[key] !== 'number' || r[key] < 0 || r[key] > 100) {
      invalid.push(`${key} must be a number 0-100, got ${JSON.stringify(r[key])}`)
    }
  }

  for (const key of requiredStrings) {
    if (!(key in r)) { missing.push(key); continue }
    if (typeof r[key] !== 'string') invalid.push(`${key} must be a string`)
  }

  if (!('rejection_reasons' in r)) {
    missing.push('rejection_reasons')
  } else if (!Array.isArray(r.rejection_reasons)) {
    invalid.push('rejection_reasons must be an array')
  }

  if (missing.length > 0 || invalid.length > 0) {
    const parts = []
    if (missing.length) parts.push(`Missing fields: ${missing.join(', ')}`)
    if (invalid.length) parts.push(`Invalid fields: ${invalid.join('; ')}`)
    throw new Error(`Gemini response failed validation — ${parts.join('. ')}`)
  }
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the task row and the linked report + before-image data URL.
 */
async function fetchTaskAndBeforeImage(pool, taskId) {
  // 1. Fetch task
  const { rows: taskRows } = await pool.query(
    'SELECT * FROM swachhlens_tasks WHERE id = $1 LIMIT 1',
    [taskId],
  )
  const task = taskRows[0]
  if (!task) throw new Error(`Task not found: ${taskId}`)

  // 2. Fetch linked report
  const { rows: reportRows } = await pool.query(
    'SELECT * FROM swachhlens_reports WHERE id = $1 LIMIT 1',
    [task.report_id],
  )
  const report = reportRows[0]
  if (!report) throw new Error(`Report not found for task ${taskId} (report_id: ${task.report_id})`)

  // 3. Fetch the before image data URL from media_uploads via image_url (path)
  let beforeImageDataUrl = null

  if (report.image_url) {
    // Try media_uploads first (data URL stored in DB — path is the key)
    const { rows: mediaRows } = await pool.query(
      'SELECT data_url, mime_type FROM media_uploads WHERE path = $1 LIMIT 1',
      [report.image_url],
    )
    if (mediaRows[0]?.data_url) {
      beforeImageDataUrl = mediaRows[0].data_url
      console.log('[VerificationAgent] Before image fetched from media_uploads.')
    } else if (report.image_url.startsWith('data:')) {
      // image_url itself is a data URL (legacy uploads)
      beforeImageDataUrl = report.image_url
      console.log('[VerificationAgent] Before image is inline data URL on report.')
    } else {
      console.warn('[VerificationAgent] Before image not found in media_uploads for path:', report.image_url)
    }
  }

  if (!beforeImageDataUrl) {
    throw new Error('Before image could not be found. The original citizen report has no usable image. Verification cannot proceed.')
  }

  return { task, report, beforeImageDataUrl }
}

/**
 * Perform the DB update inside a transaction:
 *   swachhlens_tasks  → Completed
 *   swachhlens_reports → Resolved
 */
async function applyVerificationSuccess(pool, { task, report, afterImageDataUrl, workerNote, verificationResult }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Update task
    await client.query(
      `UPDATE swachhlens_tasks SET
         status            = 'Completed',
         after_image_url   = $1,
         worker_note       = $2,
         ai_rating         = $3,
         completion_score  = $4,
         ai_feedback       = $5,
         updated_at        = now()
       WHERE id = $6`,
      [
        afterImageDataUrl,
        workerNote || '',
        verificationResult.overall_score,
        verificationResult.overall_score,
        verificationResult.ai_feedback,
        task.id,
      ],
    )

    // Update linked report
    await client.query(
      `UPDATE swachhlens_reports SET
         status         = 'Resolved',
         citizen_update = $1,
         updated_at     = now()
       WHERE id = $2`,
      [
        'Site has been cleaned and verified by AI. Awaiting final municipal confirmation.',
        report.id,
      ],
    )

    await client.query('COMMIT')
    console.log(`[VerificationAgent] DB transaction committed — task ${task.id} → Completed, report ${report.id} → Resolved.`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[VerificationAgent] DB transaction rolled back:', err.message)
    throw new Error(`Database update failed after verification: ${err.message}`)
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * runVerificationAgent({ taskId, afterImageDataUrl, workerNote })
 *
 * Returns the full verification result object:
 * {
 *   passed: boolean,          ← backend-derived (NOT Gemini's passed field)
 *   is_same_location: boolean,
 *   is_cleaned: boolean,
 *   is_relevant: boolean,
 *   location_match_confidence: number,
 *   cleaning_score: number,
 *   overall_score: number,
 *   rejection_reasons: string[],
 *   ai_feedback: string,
 *   before_scene_description: string,
 *   after_scene_description: string,
 * }
 *
 * Throws on any technical failure (missing key, API error, DB error, etc.)
 * so the route can return an appropriate 5xx to the frontend.
 */
export async function runVerificationAgent({ taskId, afterImageDataUrl, workerNote = '' }) {
  if (!taskId) throw new Error('taskId is required.')
  if (!afterImageDataUrl) throw new Error('afterImageDataUrl is required.')

  console.log(`[VerificationAgent] Received verification request for task ${taskId} (workerNote length: ${workerNote.length})`)

  // Fail fast: require API key before hitting the DB
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on this server. Verification is unavailable.')
  }

  const pool = getPool()

  // ---- Step A: Fetch task, report, and before image ----
  console.log(`[VerificationAgent] Starting verification for task ${taskId}`)
  const { task, report, beforeImageDataUrl } = await fetchTaskAndBeforeImage(pool, taskId)

  // ---- Step B: Parse both images ----
  const beforeImage = parseImageDataUrl(beforeImageDataUrl, 'before image')
  const afterImage = parseImageDataUrl(afterImageDataUrl, 'after image')

  // ---- Step C: Call Gemini Vision ----
  const geminiRaw = await callGeminiVerification(beforeImage, afterImage)

  // ---- Step D: Validate Gemini response ----
  console.log('[VerificationAgent] Gemini raw response:', JSON.stringify(geminiRaw).slice(0, 400))
  validateGeminiResponse(geminiRaw)

  // ---- Step E: Backend re-derives `passed` — never trusts Gemini's `passed` ----
  const backendPassed =
    geminiRaw.is_same_location === true &&
    geminiRaw.is_cleaned === true &&
    geminiRaw.is_relevant === true &&
    geminiRaw.overall_score >= PASS_THRESHOLD

  if (geminiRaw.passed !== backendPassed) {
    console.warn(
      `[VerificationAgent] Gemini said passed=${geminiRaw.passed} but backend computed passed=${backendPassed}. Using backend value.`,
    )
  }

  const result = {
    passed: backendPassed,
    is_same_location: geminiRaw.is_same_location,
    is_cleaned: geminiRaw.is_cleaned,
    is_relevant: geminiRaw.is_relevant,
    location_match_confidence: geminiRaw.location_match_confidence,
    cleaning_score: geminiRaw.cleaning_score,
    overall_score: geminiRaw.overall_score,
    rejection_reasons: geminiRaw.rejection_reasons,
    ai_feedback: geminiRaw.ai_feedback,
    before_scene_description: geminiRaw.before_scene_description,
    after_scene_description: geminiRaw.after_scene_description,
  }

  // ---- Step F: Update DB only on pass ----
  if (backendPassed) {
    console.log(`[VerificationAgent] Verification PASSED (score: ${result.overall_score}). Applying DB updates…`)
    await applyVerificationSuccess(pool, {
      task,
      report,
      afterImageDataUrl,
      workerNote,
      verificationResult: result,
    })
  } else {
    console.log(
      `[VerificationAgent] Verification FAILED (score: ${result.overall_score}). Reasons: ${result.rejection_reasons.join('; ')}. No DB changes.`,
    )
  }

  return result
}
