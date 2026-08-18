/**
 * Agent Routes — unified router for all agentic endpoints
 *
 * Mounted at: /api/agents
 *
 * Routes:
 *   POST /api/agents/intake              — submit a new waste report
 *   POST /api/agents/vision/analyze      — pre-submit AI image analysis
 *   POST /api/agents/dispatch/:reportId  — manually trigger dispatch for a report
 *   POST /api/agents/approve/:reportId   — human operator approves a report
 *   POST /api/agents/reject/:reportId    — human operator rejects a report
 *   GET  /api/agents/pipeline/:reportId  — check the full pipeline status of a report
 */

import { Router } from 'express'
import { runIntakeAgent } from '../agents/intakeAgent.js'
import { resolveMunicipality } from '../lib/municipalityResolver.js'

const router = Router()

// ---------------------------------------------------------------------------
// POST /api/agents/intake
// Saves the report immediately, then resolves municipality in the background.
// This is deliberately non-blocking: a Nominatim timeout must NEVER delay
// the citizen-facing response.
// ---------------------------------------------------------------------------
router.post('/intake', async (req, res) => {
  try {
    const result = await runIntakeAgent(req.body || {})
    if (!result.success) return res.status(400).json({ error: result.error })

    // Respond to the citizen immediately — municipality lookup is fire-and-forget
    res.status(201).json(result)

    // Background: resolve municipality from GPS and patch the report row
    const { report } = result
    if (report?.id && report?.latitude != null && report?.longitude != null) {
      setImmediate(async () => {
        try {
          const muni = await resolveMunicipality(report.latitude, report.longitude)
          if (muni) {
            const { getPool } = await import('../models/database.js')
            const pool = getPool()
            await pool.query(
              `UPDATE swachhlens_reports
               SET municipality_id = $1, municipality_name = $2, updated_at = now()
               WHERE id = $3 AND municipality_id IS NULL`,
              [muni.id, muni.name, report.id]
            )
            console.info(`[Route /intake] Report ${report.id} → municipality "${muni.name}" (${muni.slug})`)
          }
        } catch (err) {
          // Never crash the server over a background geocode failure
          console.error('[Route /intake] Municipality resolution error:', err.message)
        }
      })
    }
  } catch (err) {
    console.error('[Route /agents/intake]', err)
    res.status(500).json({ error: 'Intake agent encountered an unexpected error.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/agents/vision/analyze
// Pre-submission spam check + waste classification
// Body: { imageUrl, description, category }
// ---------------------------------------------------------------------------
router.post('/vision/analyze', async (req, res) => {
  const { imageUrl, description, category } = req.body || {}
  try {
    const { getPool } = await import('../models/database.js')
    const pool = getPool()
    let imageDataUrl = imageUrl

    if (imageUrl && !imageUrl.startsWith('data:')) {
      const { rows } = await pool.query(
        'SELECT data_url FROM media_uploads WHERE path = $1 LIMIT 1',
        [imageUrl]
      )
      if (rows[0]) imageDataUrl = rows[0].data_url
    }

    const { analyzeImageData } = await import('../agents/visionAgent.js')
    const analysis = await analyzeImageData(imageDataUrl, description, category)
    res.json({ success: true, analysis })
  } catch (err) {
    console.error('[Route /agents/vision/analyze]', err)
    res.status(500).json({ error: err.message || 'Vision agent failed.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/agents/dispatch/:reportId
// Manually trigger dispatch for a report (e.g. after human approval)
// ---------------------------------------------------------------------------
router.post('/dispatch/:reportId', async (req, res) => {
  const { reportId } = req.params
  try {
    const { runDispatchAgent } = await import('../agents/dispatchAgent.js')
    await runDispatchAgent(reportId)
    res.json({ success: true, message: `Dispatch triggered for report ${reportId}` })
  } catch (err) {
    console.error('[Route /agents/dispatch]', err)
    res.status(500).json({ error: err.message || 'Dispatch agent failed.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/agents/approve/:reportId
// Human operator approves a report. Triggers dispatch if not yet dispatched.
// Body: { operatorId, note? }
// ---------------------------------------------------------------------------
router.post('/approve/:reportId', async (req, res) => {
  const { reportId } = req.params
  const { operatorId = 'operator', note = '' } = req.body || {}
  try {
    const { manualApprove } = await import('../agents/approvalAgent.js')
    const result = await manualApprove(reportId, operatorId)

    // Trigger dispatch after approval if no task exists yet
    const { getPool } = await import('../models/database.js')
    const pool = getPool()
    const { rows: tasks } = await pool.query(
      `SELECT id FROM swachhlens_tasks WHERE report_id = $1 LIMIT 1`, [reportId]
    )
    if (tasks.length === 0) {
      const { runDispatchAgent } = await import('../agents/dispatchAgent.js')
      await runDispatchAgent(reportId)
    }

    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[Route /agents/approve]', err)
    res.status(500).json({ error: err.message || 'Approval agent failed.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/agents/reject/:reportId
// Human operator rejects a report.
// Body: { operatorId, reason? }
// ---------------------------------------------------------------------------
router.post('/reject/:reportId', async (req, res) => {
  const { reportId } = req.params
  const { operatorId = 'operator', reason = '' } = req.body || {}
  try {
    const { manualReject } = await import('../agents/approvalAgent.js')
    const result = await manualReject(reportId, operatorId, reason)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[Route /agents/reject]', err)
    res.status(500).json({ error: err.message || 'Rejection failed.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/agents/pipeline/:reportId
// Return full pipeline status summary for a report.
// ---------------------------------------------------------------------------
router.get('/pipeline/:reportId', async (req, res) => {
  const { reportId } = req.params
  try {
    const { getPool } = await import('../models/database.js')
    const pool = getPool()

    const { rows: reportRows } = await pool.query(
      `SELECT r.*, p.full_name AS worker_name, p.phone AS worker_phone
       FROM swachhlens_reports r
       LEFT JOIN profiles p ON r.assigned_worker_id = p.id
       WHERE r.id = $1`,
      [reportId]
    )
    if (!reportRows[0]) return res.status(404).json({ error: 'Report not found.' })

    const { rows: taskRows } = await pool.query(
      `SELECT t.*, p.full_name AS worker_name FROM swachhlens_tasks t
       LEFT JOIN profiles p ON t.worker_id = p.id
       WHERE t.report_id = $1 ORDER BY t.created_at DESC LIMIT 1`,
      [reportId]
    )

    res.json({
      success: true,
      report: reportRows[0],
      task: taskRows[0] || null,
      pipeline: {
        intake:      'Done',
        vision:      reportRows[0].confidence > 0 ? 'Done' : 'Skipped',
        correlation: reportRows[0].duplicate_count >= 1 ? 'Done' : 'Skipped',
        priority:    reportRows[0].ai_analysis?.resource_plan ? 'Done' : 'Pending',
        dispatch:    reportRows[0].assigned_worker_id ? 'Done' : 'Pending',
        approval:    reportRows[0].approval_status,
      }
    })
  } catch (err) {
    console.error('[Route /agents/pipeline]', err)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /api/agents/verify
// Worker submits after photo for AI verification.
// Body: { taskId, afterImageDataUrl, workerNote? }
// Returns: { passed, overall_score, rejection_reasons, ai_feedback, ... }
// ---------------------------------------------------------------------------
router.post('/verify', async (req, res) => {
  const { taskId, afterImageDataUrl, workerNote = '' } = req.body || {}
  if (!taskId || !afterImageDataUrl) {
    return res.status(400).json({ error: 'taskId and afterImageDataUrl are required.' })
  }
  try {
    const { runVerificationAgent } = await import('../agents/verificationAgent.js')
    const result = await runVerificationAgent({ taskId, afterImageDataUrl, workerNote })
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[Route /agents/verify]', err)
    res.status(500).json({ error: err.message || 'Verification agent failed.' })
  }
})

export default router
