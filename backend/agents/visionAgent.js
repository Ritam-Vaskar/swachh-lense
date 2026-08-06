/**
 * Vision Agent — Phase 2 (stub for now, real Gemini in Phase 2)
 *
 * This file is created as a stub so that the Intake Agent can import it
 * without crashing. Phase 2 will replace analyzeWithAI with a real Gemini
 * Vision API call.
 *
 * Responsibilities:
 * 1. Retrieve the report's image from media_uploads (or image_url)
 * 2. Call Gemini Vision API (or fallback heuristic) to classify waste
 * 3. Update swachhlens_reports with ai_analysis JSONB and new status/priority
 * 4. Trigger Correlation Agent and Priority Agent next
 */

import { getPool } from '../models/database.js'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

// ---------------------------------------------------------------------------
// Fallback keyword heuristic (used when GEMINI_API_KEY is absent)
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS = {
  'Overflowing bin': ['bin', 'garbage', 'overflow', 'dustbin', 'trash can'],
  'Illegal dumpsite': ['dump', 'debris', 'construction', 'rubble', 'dumped'],
  'Blocked drain': ['drain', 'sewage', 'water', 'clogged', 'flood'],
  'Street litter': ['litter', 'wrapper', 'plastic', 'cups', 'street'],
  'Medical waste': ['syringe', 'medical', 'hospital', 'gloves', 'mask'],
  'Construction debris': ['debris', 'bricks', 'cement', 'construction'],
  'Dead animal': ['dead', 'animal', 'carcass', 'dog', 'cat'],
  'Public toilet issue': ['toilet', 'urinal', 'bathroom', 'latrine'],
}

const VOLUME_KEYWORDS = {
  Overflowing: ['overflow', 'spilling', 'huge', 'massive', 'pile'],
  Large: ['large', 'big', 'lot', 'many', 'heavy'],
  Medium: ['medium', 'some', 'few bags'],
  Small: ['small', 'little', 'few', 'minor'],
}

function heuristicAnalysis({ description = '', category = '', hazard_flag = false }) {
  const text = `${category} ${description}`.toLowerCase()

  let detectedCategory = category
  if (!detectedCategory) {
    for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
      if (words.some((w) => text.includes(w))) { detectedCategory = cat; break }
    }
    detectedCategory = detectedCategory || 'Street litter'
  }

  let volume = 'Medium'
  for (const [vol, words] of Object.entries(VOLUME_KEYWORDS)) {
    if (words.some((w) => text.includes(w))) { volume = vol; break }
  }

  const volumeScore = { Small: 30, Medium: 50, Large: 75, Overflowing: 95 }[volume]
  const hazardWords = ['syringe', 'medical', 'blood', 'chemical', 'dead', 'flood', 'overflow', 'hazard']
  const detectedHazard = hazard_flag || hazardWords.some((w) => text.includes(w))
  let severity = volumeScore + (detectedHazard ? 10 : 0)
  severity = Math.min(100, severity)

  const team_size = volume === 'Overflowing' ? 4 : volume === 'Large' ? 3 : volume === 'Medium' ? 2 : 1
  let priority = 'Low'
  if (severity >= 85) priority = 'Critical'
  else if (severity >= 65) priority = 'High'
  else if (severity >= 40) priority = 'Medium'

  const autoApproved = severity >= 85 && detectedHazard

  return {
    category: detectedCategory,
    volume,
    severity_score: severity,
    priority,
    confidence: 65, // lower confidence for heuristic — will trigger human review
    team_size,
    hazard_flag: detectedHazard,
    autoApproved,
    method: 'heuristic',
    reasoning: 'Analyzed via keyword heuristic (no Gemini API key configured).',
    summary: `${detectedCategory} — ${volume.toLowerCase()} volume detected. ${detectedHazard ? 'Health/safety hazard flagged. ' : ''}Recommended team of ${team_size}. Priority ${priority}.`,
  }
}

// ---------------------------------------------------------------------------
// Real Gemini Vision analysis (active when GEMINI_API_KEY is set)
// ---------------------------------------------------------------------------

async function analyzeWithGemini(imageDataUrl, description = '', category = '') {
  const prompt = `You are a waste management AI analyst. Analyze this image of a waste problem and return a JSON object with EXACTLY these fields:
{
  "category": one of ["Overflowing bin","Illegal dumpsite","Blocked drain","Street litter","Medical waste","Construction debris","Dead animal","Public toilet issue"],
  "volume": one of ["Small","Medium","Large","Overflowing"],
  "hazard_flag": boolean (true if visible health/safety risk),
  "severity_score": integer 1-100,
  "team_size": integer 1-5 (workers needed),
  "confidence": integer 50-99 (your confidence in this analysis),
  "reasoning": "brief 1-2 sentence explanation of what you see",
  "summary": "actionable summary for the operations team"
}
Context from reporter: "${description || 'No description provided'}". ${category ? `Suggested category: ${category}.` : ''}
Return ONLY the JSON object. No markdown, no code fences.`

  // Extract base64 data from data URL
  const [header, base64Data] = imageDataUrl.split(',')
  const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg'

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Data } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024, responseMimeType: "application/json" },
      }),
    },
  )

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${errText}`)
  }

  const result = await response.json()
  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || ''

  // Parse JSON from the model response
  const cleaned = rawText.replace(/```json|```/g, '').trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    console.error('[VisionAgent] JSON parse error. Raw output from Gemini:', rawText)
    throw err
  }

  // Derive priority from severity
  let priority = 'Low'
  if (parsed.severity_score >= 85) priority = 'Critical'
  else if (parsed.severity_score >= 65) priority = 'High'
  else if (parsed.severity_score >= 40) priority = 'Medium'

  return {
    ...parsed,
    priority,
    autoApproved: parsed.confidence >= 80 && !parsed.hazard_flag && parsed.severity_score < 75,
    method: 'gemini-1.5-flash',
  }
}

// ---------------------------------------------------------------------------
// Main Vision Agent entry point
// ---------------------------------------------------------------------------

export async function runVisionAgent(reportId) {
  const pool = getPool()

  // 1. Fetch the report
  const { rows: reportRows } = await pool.query(
    'SELECT * FROM swachhlens_reports WHERE id = $1 LIMIT 1',
    [reportId],
  )
  const report = reportRows[0]
  if (!report) {
    console.warn('[VisionAgent] Report not found:', reportId)
    return
  }

  // 2. Get the image data (stored in media_uploads or directly as image_url)
  let imageDataUrl = null
  if (report.image_url) {
    // Try to retrieve from media_uploads table first
    const { rows: mediaRows } = await pool.query(
      'SELECT data_url FROM media_uploads WHERE path = $1 LIMIT 1',
      [report.image_url],
    )
    imageDataUrl = mediaRows[0]?.data_url || report.image_url
  }

  // 3. Run analysis
  let analysis
  if (GEMINI_API_KEY && imageDataUrl && imageDataUrl.startsWith('data:')) {
    try {
      console.log('[VisionAgent] Running Gemini Vision analysis for report', reportId)
      analysis = await analyzeWithGemini(imageDataUrl, report.description, report.category)
    } catch (err) {
      console.error('[VisionAgent] Gemini call failed, falling back to heuristic:', err.message)
      analysis = heuristicAnalysis({ description: report.description, category: report.category, hazard_flag: report.hazard_flag })
    }
  } else {
    if (GEMINI_API_KEY && !imageDataUrl) {
      console.log('[VisionAgent] No image found for report', reportId, '— using text heuristic')
    } else if (!GEMINI_API_KEY) {
      console.log('[VisionAgent] No GEMINI_API_KEY set — using heuristic for report', reportId)
    }
    analysis = heuristicAnalysis({ description: report.description, category: report.category, hazard_flag: report.hazard_flag })
  }

  // 4. Determine approval status from analysis
  const approvalStatus = analysis.autoApproved ? 'Auto-approved' : 'Pending'
  const citizenUpdate = analysis.autoApproved
    ? 'Report auto-approved and queued for worker assignment.'
    : analysis.hazard_flag
      ? 'Report flagged for urgent operator review due to detected hazard.'
      : 'Report received and awaiting operator review.'

  // 5. Update the report with AI analysis results
  await pool.query(
    `UPDATE swachhlens_reports SET
       ai_analysis = $1,
       category = $2,
       volume = $3,
       severity_score = $4,
       priority = $5,
       hazard_flag = $6,
       confidence = $7,
       team_size = $8,
       approval_status = $9,
       citizen_update = $10,
       status = 'New',
       updated_at = now()
     WHERE id = $11`,
    [
      JSON.stringify(analysis),
      analysis.category || report.category,
      analysis.volume || report.volume,
      analysis.severity_score,
      analysis.priority,
      analysis.hazard_flag,
      analysis.confidence,
      analysis.team_size,
      approvalStatus,
      citizenUpdate,
      reportId,
    ],
  )

  console.log(`[VisionAgent] Report ${reportId} analyzed: ${analysis.category}, severity ${analysis.severity_score}, ${approvalStatus}`)

  // 6. Chain to Correlation Agent + Priority Agent (Phase 3/4 will implement these)
  setImmediate(async () => {
    try {
      const { runCorrelationAgent } = await import('./correlationAgent.js')
      await runCorrelationAgent(reportId)
    } catch {
      // correlationAgent not yet implemented — safe to ignore
    }
    try {
      const { runApprovalAgent } = await import('./approvalAgent.js')
      if (analysis.autoApproved) await runApprovalAgent(reportId, 'auto')
    } catch {
      // approvalAgent not yet implemented — safe to ignore
    }
  })

  return analysis
}
