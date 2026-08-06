import { getPool } from '../models/database.js'

// ─── Approval Thresholds ───────────────────────────────────────────────────
// Auto-approve when ALL conditions are met:
//   confidence >= 75, severity_score < 80, no hazard flag
// Otherwise flag for human review on the dashboard.
const AUTO_APPROVE_MIN_CONFIDENCE = 75
const AUTO_APPROVE_MAX_SEVERITY   = 80

export async function runApprovalAgent(reportId, taskId = null) {
  const pool = getPool()

  // 1. Fetch the report
  const { rows } = await pool.query('SELECT * FROM swachhlens_reports WHERE id = $1', [reportId])
  const report = rows[0]
  if (!report) {
    console.error(`[ApprovalAgent] Report ${reportId} not found.`)
    return
  }

  const confidence   = report.confidence   || 0
  const severity     = report.severity_score || 50
  const isHazard     = report.hazard_flag  || false

  // 2. Decision
  const autoApprove = (
    confidence   >= AUTO_APPROVE_MIN_CONFIDENCE &&
    severity     <  AUTO_APPROVE_MAX_SEVERITY   &&
    !isHazard
  )

  const approvalStatus = autoApprove ? 'Auto-approved' : 'Pending'
  const citizenUpdate  = autoApprove
    ? `Your report has been verified and a cleanup crew has been dispatched. Estimated arrival: ${report.ai_analysis?.resource_plan?.vehicle_type || 'crew'} in ~30 minutes.`
    : 'Your report has been flagged for priority review by the operations team. You will be notified once approved.'

  console.log(
    `[ApprovalAgent] Report ${report.reference_code} → ${approvalStatus} ` +
    `(confidence: ${confidence}%, severity: ${severity}, hazard: ${isHazard})`
  )

  // 3. Update the report
  await pool.query(
    `UPDATE swachhlens_reports SET 
       approval_status = $1, 
       citizen_update  = $2, 
       updated_at      = now()
     WHERE id = $3`,
    [approvalStatus, citizenUpdate, reportId]
  )

  // 4. Update task status if one was assigned
  if (taskId) {
    const taskStatus = autoApprove ? 'Assigned' : 'Pending Approval'
    await pool.query(
      `UPDATE swachhlens_tasks SET status = $1, updated_at = now() WHERE id = $2`,
      [taskStatus, taskId]
    )
  }

  return { reportId, approvalStatus, autoApprove }
}

// ─── Manual human approval (called from API route) ─────────────────────────
export async function manualApprove(reportId, operatorId) {
  const pool = getPool()

  await pool.query(
    `UPDATE swachhlens_reports SET 
       approval_status = 'Approved',
       citizen_update  = 'Your report has been approved by the operations team. A crew has been dispatched.',
       status          = 'Assigned',
       updated_at      = now()
     WHERE id = $1`,
    [reportId]
  )

  // Activate any pending tasks for this report
  await pool.query(
    `UPDATE swachhlens_tasks SET status = 'Assigned', updated_at = now()
     WHERE report_id = $1 AND status = 'Pending Approval'`,
    [reportId]
  )

  console.log(`[ApprovalAgent] Report ${reportId} manually APPROVED by operator ${operatorId}.`)
  return { success: true, approvalStatus: 'Approved' }
}

// ─── Manual human rejection (called from API route) ────────────────────────
export async function manualReject(reportId, operatorId, reason = '') {
  const pool = getPool()

  await pool.query(
    `UPDATE swachhlens_reports SET 
       approval_status = 'Rejected',
       status          = 'Rejected',
       citizen_update  = $1,
       updated_at      = now()
     WHERE id = $2`,
    [`Your report has been reviewed and rejected by the operations team${reason ? ': ' + reason : '.'}.`, reportId]
  )

  await pool.query(
    `UPDATE swachhlens_tasks SET status = 'Cancelled', updated_at = now()
     WHERE report_id = $1`,
    [reportId]
  )

  console.log(`[ApprovalAgent] Report ${reportId} manually REJECTED by operator ${operatorId}. Reason: ${reason || 'none'}`)
  return { success: true, approvalStatus: 'Rejected' }
}
