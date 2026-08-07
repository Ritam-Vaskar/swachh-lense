import { getPool } from '../models/database.js'

// Haversine formula to calculate distance in meters between two lat/lng points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3 // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

export async function runCorrelationAgent(reportId) {
  const pool = getPool()

  // 1. Fetch the newly analyzed report
  const { rows: targetRows } = await pool.query('SELECT * FROM swachhlens_reports WHERE id = $1', [reportId])
  const target = targetRows[0]

  if (!target) {
    console.error(`[CorrelationAgent] Report ${reportId} not found.`)
    return
  }

  console.log(`[CorrelationAgent] Checking report ${target.reference_code} | Category: "${target.category}" | GPS: ${target.latitude ? `${target.latitude}, ${target.longitude}` : 'NO GPS'} | Zone: ${target.zone}`)

  // ─── PATH A: GPS-based spatial correlation ──────────────────────────────────
  if (target.latitude && target.longitude) {
    const { rows: openReports } = await pool.query(
      `SELECT * FROM swachhlens_reports 
       WHERE status IN ('New', 'Assigned', 'In Progress') 
         AND category = $1 
         AND id != $2 
         AND latitude IS NOT NULL 
         AND longitude IS NOT NULL`,
      [target.category, reportId]
    )

    let parentReport = null
    let minDistance = Infinity

    for (const r of openReports) {
      const dist = calculateDistance(target.latitude, target.longitude, r.latitude, r.longitude)
      console.log(`[CorrelationAgent]   └─ vs ${r.reference_code}: ${Math.round(dist)}m away`)
      if (dist <= 100 && dist < minDistance) {
        minDistance = dist
        parentReport = r
      }
    }

    if (parentReport) {
      return markAsDuplicate(pool, target, parentReport, `${Math.round(minDistance)}m GPS match`)
    }

    console.log(`[CorrelationAgent] No GPS duplicate found within 100m. Checking zone fallback...`)
  }

  // ─── PATH B: Zone + Category + Time-window fallback (no GPS, or GPS miss) ───
  // Look for the same category in the same zone within the last 12 hours
  const { rows: zoneFallback } = await pool.query(
    `SELECT * FROM swachhlens_reports 
     WHERE status IN ('New', 'Assigned', 'In Progress', 'Duplicate')
       AND category = $1 
       AND zone = $2
       AND id != $3
       AND reported_at > now() - interval '12 hours'
     ORDER BY reported_at ASC
     LIMIT 1`,
    [target.category, target.zone, reportId]
  )

  if (zoneFallback.length > 0) {
    const parent = zoneFallback[0]
    console.log(`[CorrelationAgent] Zone fallback matched: ${target.reference_code} → ${parent.reference_code} (same category+zone within 12h)`)
    return markAsDuplicate(pool, target, parent, 'same zone + category + 12h window')
  }

  // ─── Unique ─────────────────────────────────────────────────────────────────
  console.log(`[CorrelationAgent] Report ${target.reference_code} is unique. Proceeding to priority planning.`)
  chainToPriorityAgent(reportId)
}

async function markAsDuplicate(pool, target, parentReport, reason) {
  console.log(`[CorrelationAgent] DUPLICATE: ${target.reference_code} → ${parentReport.reference_code} (${reason})`)

  // Increment duplicate_count on the parent report
  await pool.query(
    `UPDATE swachhlens_reports SET duplicate_count = duplicate_count + 1, updated_at = now() WHERE id = $1`,
    [parentReport.id]
  )

  // Mark the new report as Duplicate
  await pool.query(
    `UPDATE swachhlens_reports 
     SET status = 'Duplicate', 
         citizen_update = $1, 
         updated_at = now() 
     WHERE id = $2`,
    [`This issue is already being tracked (Ref: ${parentReport.reference_code}). Your report has been linked to boost its priority!`, target.id]
  )

  // Trigger Priority Agent on the *parent* so it recalculates with the boosted duplicate_count
  chainToPriorityAgent(parentReport.id)
}

function chainToPriorityAgent(reportId) {
  setImmediate(async () => {
    try {
      const { runPriorityAgent } = await import('./priorityAgent.js')
      await runPriorityAgent(reportId)
    } catch (err) {
      console.error('[CorrelationAgent] Failed to chain to Priority Agent:', err)
    }
  })
}
