/**
 * municipalityRoutes.js
 *
 * Mounted at: /api/municipalities
 *
 * Routes:
 *   GET /api/municipalities           — list all municipalities
 *   GET /api/municipalities/stats     — per-municipality KPI counts
 *   GET /api/municipalities/:id/reports — reports scoped to one municipality
 */

import { Router } from 'express'

const router = Router()

// ---------------------------------------------------------------------------
// GET /api/municipalities
// List all municipalities ordered by name.
// ---------------------------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    const { getPool } = await import('../models/database.js')
    const pool = getPool()
    const { rows } = await pool.query(
      `SELECT * FROM municipalities ORDER BY name ASC`
    )
    res.json({ data: rows })
  } catch (err) {
    console.error('[Route /municipalities]', err)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/municipalities/stats
// Per-municipality aggregated KPIs — total, active, critical, pending_approval.
// ---------------------------------------------------------------------------
router.get('/stats', async (_req, res) => {
  try {
    const { getPool } = await import('../models/database.js')
    const pool = getPool()

    const { rows: munis } = await pool.query(`SELECT * FROM municipalities ORDER BY name ASC`)
    const { rows: reportRows } = await pool.query(`
      SELECT
        municipality_id,
        municipality_name,
        status,
        priority,
        approval_status
      FROM swachhlens_reports
    `)

    const statsMap = {}
    for (const m of munis) {
      statsMap[m.id] = {
        id:           m.id,
        slug:         m.slug,
        name:         m.name,
        city:         m.city,
        state:        m.state,
        lat_center:   m.lat_center,
        lng_center:   m.lng_center,
        total:        0,
        active:       0,
        critical:     0,
        resolved:     0,
        pending:      0,
      }
    }
    // Unassigned bucket
    statsMap['__unassigned__'] = {
      id: null, slug: 'unassigned', name: 'Unassigned', city: '—', state: '—',
      total: 0, active: 0, critical: 0, resolved: 0, pending: 0,
    }

    for (const r of reportRows) {
      const key = r.municipality_id || '__unassigned__'
      const s   = statsMap[key]
      if (!s) continue
      s.total++
      if (r.status !== 'Closed' && r.status !== 'Resolved') s.active++
      if (r.status === 'Resolved' || r.status === 'Closed') s.resolved++
      if (r.priority === 'Critical' && r.status !== 'Closed') s.critical++
      if (r.approval_status === 'Pending') s.pending++
    }

    res.json({ data: Object.values(statsMap).filter((s) => s.id !== null || s.total > 0) })
  } catch (err) {
    console.error('[Route /municipalities/stats]', err)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/municipalities/:id/reports
// Returns all reports belonging to a specific municipality.
// Supports query params: status, priority, approval_status, limit, offset
// ---------------------------------------------------------------------------
router.get('/:id/reports', async (req, res) => {
  const { id } = req.params
  const { status, priority, approval_status, limit = 200, offset = 0 } = req.query

  try {
    const { getPool } = await import('../models/database.js')
    const pool = getPool()

    const clauses = [`municipality_id = $1`]
    const params  = [id]

    if (status) {
      params.push(status)
      clauses.push(`status = $${params.length}`)
    }
    if (priority) {
      params.push(priority)
      clauses.push(`priority = $${params.length}`)
    }
    if (approval_status) {
      params.push(approval_status)
      clauses.push(`approval_status = $${params.length}`)
    }

    params.push(Number(limit), Number(offset))
    const limitOffset = `LIMIT $${params.length - 1} OFFSET $${params.length}`

    const { rows } = await pool.query(
      `SELECT * FROM swachhlens_reports
       WHERE ${clauses.join(' AND ')}
       ORDER BY reported_at DESC
       ${limitOffset}`,
      params
    )

    res.json({ data: rows })
  } catch (err) {
    console.error('[Route /municipalities/:id/reports]', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
