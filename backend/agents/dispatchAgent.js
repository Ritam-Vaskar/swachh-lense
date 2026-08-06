import { getPool } from '../models/database.js'

// Haversine distance in meters between two lat/lng points
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function runDispatchAgent(reportId) {
  const pool = getPool()

  // 1. Fetch the report
  const { rows: reportRows } = await pool.query('SELECT * FROM swachhlens_reports WHERE id = $1', [reportId])
  const report = reportRows[0]
  if (!report) {
    console.error(`[DispatchAgent] Report ${reportId} not found.`)
    return
  }

  // Skip if already assigned or duplicate
  if (report.status === 'Assigned' || report.status === 'Duplicate') {
    console.log(`[DispatchAgent] Report ${report.reference_code} is ${report.status}. Skipping dispatch.`)
    return
  }

  const resourcePlan = report.ai_analysis?.resource_plan || {}
  const requiredTeamSize = resourcePlan.recommended_team_size || report.team_size || 1
  const requiredVehicle  = resourcePlan.vehicle_type || 'Pushcart'

  // 2. Fetch available workers in the same zone first, then any zone
  const { rows: workers } = await pool.query(
    `SELECT p.*, au.email FROM profiles p 
     LEFT JOIN app_users au ON p.id = au.id
     WHERE p.is_available = true AND p.role = 'worker'`,
  )

  if (workers.length === 0) {
    console.log(`[DispatchAgent] No available workers found. Report ${report.reference_code} will be manually dispatched.`)
    await pool.query(
      `UPDATE swachhlens_reports SET citizen_update = $1, updated_at = now() WHERE id = $2`,
      ['No workers currently available. A crew will be assigned shortly by the operations team.', reportId]
    )
    chainToApprovalAgent(reportId)
    return
  }

  // 3. Score each worker
  // Priority: same zone > nearest by GPS > any available
  const scored = workers.map(w => {
    let score = 0
    if (w.zone === report.zone) score += 100          // same zone bonus
    if (w.latitude && w.longitude && report.latitude && report.longitude) {
      const dist = getDistance(report.latitude, report.longitude, w.latitude, w.longitude)
      score += Math.max(0, 50 - dist / 1000)          // closer = higher score (up to 50pts per km)
    }
    return { worker: w, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0].worker

  // 4. ETA estimate (simple heuristic based on distance or fallback)
  let etaMin = 30
  if (best.latitude && report.latitude) {
    const dist = getDistance(report.latitude, report.longitude, best.latitude, best.longitude) / 1000
    etaMin = Math.max(10, Math.round(dist * 6)) // ~10 km/h avg urban speed
  }

  // 5. Create a task record
  const taskCode = `TASK-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(2, 4)}`
  const scheduledFor = new Date(Date.now() + etaMin * 60000).toISOString()

  const { rows: taskRows } = await pool.query(
    `INSERT INTO swachhlens_tasks 
      (id, report_id, task_code, crew_name, vehicle, eta, status, scheduled_for, latitude, longitude, worker_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      crypto.randomUUID(),
      reportId,
      taskCode,
      best.full_name,
      requiredVehicle,
      `${etaMin} min`,
      'Assigned',
      scheduledFor,
      report.latitude,
      report.longitude,
      best.id,
    ]
  )
  const task = taskRows[0]

  // 6. Update the report with the assignment
  await pool.query(
    `UPDATE swachhlens_reports SET 
       assigned_worker_id = $1, 
       status = 'Assigned', 
       updated_at = now()
     WHERE id = $2`,
    [best.id, reportId]
  )

  console.log(`[DispatchAgent] Report ${report.reference_code} dispatched → ${best.full_name} (${requiredVehicle}, ETA ${etaMin}min)`)

  // 7. Chain to Approval Agent
  chainToApprovalAgent(reportId, task.id)
}

function chainToApprovalAgent(reportId, taskId) {
  setImmediate(async () => {
    try {
      const { runApprovalAgent } = await import('./approvalAgent.js')
      await runApprovalAgent(reportId, taskId)
    } catch (err) {
      console.error('[DispatchAgent] Failed to chain to Approval Agent:', err)
    }
  })
}
