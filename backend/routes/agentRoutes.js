/**
 * Agent Routes — unified router for all agentic endpoints
 *
 * Mounted at: /api/agents
 *
 * Current routes (Phase 1):
 *   POST /api/agents/intake      — submit a new waste report
 *
 * Future routes (added per phase):
 *   POST /api/agents/vision/analyze
 *   POST /api/agents/priority/plan
 *   POST /api/agents/dispatch
 *   POST /api/agents/approval/approve
 *   POST /api/agents/approval/reject
 *   POST /api/agents/verify
 */

import { Router } from 'express'
import { runIntakeAgent } from '../agents/intakeAgent.js'
import { runVisionAgent } from '../agents/visionAgent.js'

const router = Router()

// ---------------------------------------------------------------------------
// POST /api/agents/intake
// Accept a new report from citizen or operator.
// Body: { category, location, zone, latitude, longitude, volume, hazard_flag,
//         description, resident_name, citizen_phone, image_url }
// ---------------------------------------------------------------------------
router.post('/intake', async (req, res) => {
  try {
    const result = await runIntakeAgent(req.body || {})
    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }
    res.status(201).json(result)
  } catch (err) {
    console.error('[Route /agents/intake]', err)
    res.status(500).json({ error: 'Intake agent encountered an unexpected error.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/agents/vision/analyze
// Manually (re-)trigger vision analysis for an existing report.
// Body: { reportId }
// ---------------------------------------------------------------------------
router.post('/vision/analyze', async (req, res) => {
  const { reportId } = req.body || {}
  if (!reportId) {
    return res.status(400).json({ error: 'reportId is required.' })
  }
  try {
    const analysis = await runVisionAgent(reportId)
    res.json({ success: true, analysis })
  } catch (err) {
    console.error('[Route /agents/vision/analyze]', err)
    res.status(500).json({ error: 'Vision agent failed.' })
  }
})

export default router
