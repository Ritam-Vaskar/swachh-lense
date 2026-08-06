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
import sharp from 'sharp'

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

/**
 * Resize and compress a base64 image data URL to max 768px on the longest side
 * and JPEG quality 70 to minimize Gemini input token usage.
 */
async function resizeImageDataUrl(dataUrl) {
  const [header, base64Data] = dataUrl.split(',')
  const buffer = Buffer.from(base64Data, 'base64')
  const resized = await sharp(buffer)
    .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer()
  return `data:image/jpeg;base64,${resized.toString('base64')}`
}

async function analyzeWithGemini(imageDataUrl, description = '', category = '') {
  const prompt = `You are a waste management AI analyst. Analyze this image and return a JSON object with EXACTLY these fields:
{
  "is_waste": boolean (true if the image actually depicts waste/garbage/overflow, false if it's unrelated like a selfie, pet, landscape, etc.),
  "category": one of ["Overflowing bin","Illegal dumpsite","Blocked drain","Street litter","Medical waste","Construction debris","Dead animal","Public toilet issue", "Not Waste"],
  "volume": one of ["Small","Medium","Large","Overflowing"],
  "hazard_flag": boolean (true if visible health/safety risk),
  "severity_score": integer 1-100,
  "team_size": integer 1-5 (workers needed),
  "confidence": integer 50-99 (your confidence in this analysis),
  "reasoning": "brief 1-2 sentence explanation of what you see and why you flagged it",
  "summary": "actionable summary for the operations team (or explanation of why it is rejected)"
}
Context from reporter: "${description || 'No description provided'}". ${category ? `Suggested category: ${category}.` : ''}
Return ONLY the JSON object. No markdown, no code fences.`

  // Resize image before sending to Gemini to avoid token budget issues
  let processedDataUrl = imageDataUrl
  try {
    processedDataUrl = await resizeImageDataUrl(imageDataUrl)
    console.log('[VisionAgent] Image resized for Gemini.')
  } catch (err) {
    console.warn('[VisionAgent] Image resize failed, using original:', err.message)
  }

  // Extract base64 data from data URL
  const [header, base64Data] = processedDataUrl.split(',')
  const mimeType = 'image/jpeg'

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
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
    },
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
  if (!rawText) {
    throw new Error('Gemini returned an empty response. Raw result: ' + JSON.stringify(result))
  }

  // Sanitize and parse JSON from the model response
  // Gemini sometimes uses Unicode smart quotes or other special chars inside strings
  const stripped = rawText.replace(/```json|```/g, '').trim()

  // Replace smart/curly quotes with standard ASCII quotes
  const sanitized = stripped
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // curly double quotes → "
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // curly single quotes → '
    .replace(/[\u2013\u2014]/g, '-')               // em/en dashes → -
    .replace(/[\u2026]/g, '...')                   // ellipsis → ...
    .replace(/[\r\n]+/g, ' ')                      // collapse newlines within strings

  let parsed
  try {
    parsed = JSON.parse(sanitized)
  } catch (err) {
    // Last resort: extract each field individually with regex
    console.error('[VisionAgent] JSON parse error. Raw output from Gemini:', rawText)
    console.error('[VisionAgent] Attempting field-by-field extraction...')
    try {
      const extract = (key, fallback) => {
        const m = stripped.match(new RegExp(`"${key}"\\s*:\\s*([^,}\\n]+)`))
        return m ? m[1].trim().replace(/^"|"$/g, '').replace(/,$/, '') : fallback
      }
      const extractBool = (key, fallback) => {
        const m = stripped.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`))
        return m ? m[1] === 'true' : fallback
      }
      const extractNum = (key, fallback) => {
        const m = stripped.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`))
        return m ? parseInt(m[1], 10) : fallback
      }
      const extractStr = (key, fallback) => {
        const m = stripped.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 's'))
        return m ? m[1] : fallback
      }
      parsed = {
        is_waste: extractBool('is_waste', true),
        category: extractStr('category', 'General waste'),
        volume: extractStr('volume', 'Medium'),
        hazard_flag: extractBool('hazard_flag', false),
        severity_score: extractNum('severity_score', 50),
        team_size: extractNum('team_size', 1),
        confidence: extractNum('confidence', 60),
        reasoning: extractStr('reasoning', ''),
        summary: extractStr('summary', ''),
      }
      console.log('[VisionAgent] Field extraction succeeded:', parsed)
    } catch (e2) {
      throw new Error('Gemini returned unparseable JSON: ' + err.message)
    }
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
// Main Vision Agent entry points
// ---------------------------------------------------------------------------

export async function analyzeImageData(imageDataUrl, description, category) {
  if (GEMINI_API_KEY && imageDataUrl && imageDataUrl.startsWith('data:')) {
    console.log('[VisionAgent] Running Gemini Vision analysis...')
    const analysis = await analyzeWithGemini(imageDataUrl, description, category)
    return analysis
  } else {
    throw new Error('Missing Gemini API key or invalid image data.')
  }
}

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

  // 2. Get the image data
  let imageDataUrl = null
  if (report.image_url) {
    const { rows: mediaRows } = await pool.query(
      'SELECT data_url FROM media_uploads WHERE path = $1 LIMIT 1',
      [report.image_url],
    )
    imageDataUrl = mediaRows[0]?.data_url || report.image_url
  }

  // 3. Run analysis
  const analysis = await analyzeImageData(imageDataUrl, report.description, report.category)

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

  // 6. Chain to Correlation Agent (Phase 3)
  setImmediate(async () => {
    try {
      const { runCorrelationAgent } = await import('./correlationAgent.js')
      await runCorrelationAgent(reportId)
    } catch (err) {
      console.error('[VisionAgent] Failed to chain to Correlation Agent:', err)
    }
  })

  return analysis
}
