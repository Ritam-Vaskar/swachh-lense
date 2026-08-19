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

    // Reset backoff on successful run
    _consecutiveFailures = 0

  } catch (err) {
    _consecutiveFailures++
    const isConnectError = err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT'

    if (isConnectError) {
      // Only log the first occurrence and then every 10th — suppress the flood
      if (_consecutiveFailures === 1) {
        console.warn(`[EscalationAgent] ⚠ Database unreachable (${err.code}${err.hostname ? ': ' + err.hostname : ''}). Checks will back off until DB is online.`)
      } else if (_consecutiveFailures % 10 === 0) {
        console.warn(`[EscalationAgent] Still unreachable after ${_consecutiveFailures} attempts. Waiting for DB...`)
      }
    } else {
      // Non-connection errors — always log with message only (no giant stack)
      console.error('[EscalationAgent] Error running escalation check:', err.message)
    }
  }
}

// Backoff state
let _consecutiveFailures = 0
let intervalId = null

export function startEscalationAgent(baseIntervalMs = 60000) {
  if (intervalId) {
    clearTimeout(intervalId)
    intervalId = null
  }
  _consecutiveFailures = 0

  console.log(`[EscalationAgent] Started with base interval ${baseIntervalMs}ms`)

  // Recursive setTimeout with adaptive exponential backoff when DB is unreachable
  const scheduleNext = async () => {
    await runEscalationCheck()

    // Exponential backoff: 60s → 120s → 240s → 480s → 600s (max)
    const backoffFactor = _consecutiveFailures > 0 ? Math.pow(2, Math.min(_consecutiveFailures - 1, 4)) : 1
    const nextMs = Math.min(baseIntervalMs * backoffFactor, 600000)

    intervalId = setTimeout(scheduleNext, nextMs)
  }

  // Kick off immediately
  scheduleNext()

  return {
    stop: () => {
      clearTimeout(intervalId)
      intervalId = null
      console.log('[EscalationAgent] Stopped.')
    }
  }
}
