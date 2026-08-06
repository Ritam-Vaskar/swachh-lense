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
// Synchronously analyze a photo to detect spam or extract waste info before submission.
// Body: { imageUrl, description, category }
// ---------------------------------------------------------------------------
router.post('/vision/analyze', async (req, res) => {
  const { imageUrl, description, category } = req.body || {}
  try {
    const { getPool } = await import('../models/database.js')
    const pool = getPool()
    let imageDataUrl = imageUrl
    
    // If it's a media path, look up the data_url
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
    res.status(500).json({ error: 'Vision agent failed.' })
  }
})

export default router
