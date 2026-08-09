import { getPool } from '../models/database.js'

export async function runEscalationCheck() {
  const pool = getPool()
  
  try {
    // 1. Escalate breached Reports (stuck in New/Pending for > 15 mins)
    const { rows: breachedReports } = await pool.query(
      `SELECT id, reference_code FROM swachhlens_reports 
       WHERE status = 'New' 
       AND created_at < now() - interval '15 minutes'
       AND priority != 'Critical'`
    )

    if (breachedReports.length > 0) {
      console.log(`[EscalationAgent] Found ${breachedReports.length} reports breaching SLA. Escalating...`)
      
      const reportIds = breachedReports.map(r => r.id)
      
      await pool.query(
        `UPDATE swachhlens_reports 
         SET priority = 'Critical',
             citizen_update = 'Report escalated for urgent attention due to SLA breach.',
             updated_at = now()
         WHERE id = ANY($1)`,
        [reportIds]
      )
    }

    // 2. Escalate breached Tasks (Assigned/In Progress for > 30 mins)
    const { rows: breachedTasks } = await pool.query(
      `SELECT t.id, t.report_id, t.task_code 
       FROM swachhlens_tasks t
       WHERE t.status IN ('Assigned', 'In Progress')
       AND t.created_at < now() - interval '30 minutes'
       AND t.escalated = false`
    )

    if (breachedTasks.length > 0) {
      console.log(`[EscalationAgent] Found ${breachedTasks.length} tasks breaching SLA. Escalating...`)

      const taskIds = breachedTasks.map(t => t.id)
      const reportIdsForTasks = breachedTasks.map(t => t.report_id)

      // Mark tasks as escalated
      await pool.query(
        `UPDATE swachhlens_tasks 
         SET escalated = true, updated_at = now() 
         WHERE id = ANY($1)`,
        [taskIds]
      )

      // Elevate the associated reports to Critical
      await pool.query(
        `UPDATE swachhlens_reports 
         SET priority = 'Critical', updated_at = now() 
         WHERE id = ANY($1) AND priority != 'Critical'`,
        [reportIdsForTasks]
      )

      for (const t of breachedTasks) {
        console.log(`[EscalationAgent] ALERT: Supervisor notified for Task ${t.task_code}`)
      }
    }
  } catch (err) {
    console.error('[EscalationAgent] Error running escalation check:', err)
  }
}

let intervalId = null

export function startEscalationAgent(intervalMs = 60000) {
  if (intervalId) clearInterval(intervalId)
  
  console.log(`[EscalationAgent] Started with interval ${intervalMs}ms`)
  
  runEscalationCheck()
  
  intervalId = setInterval(runEscalationCheck, intervalMs)
  
  return intervalId
}
