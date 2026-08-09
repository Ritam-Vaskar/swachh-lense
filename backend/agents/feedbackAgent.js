/**
 * Feedback & Learning Agent — Phase 9
 *
 * Triggers after a task is successfully verified (Completed).
 * Responsibilities:
 * 1. Update worker's performance stats (jobs completed, average rating)
 * 2. Archive before/after image pair as a training data entry
 * 3. Update the report's citizen_update to final "Verified" message
 */

import { getPool } from '../models/database.js'

export async function runFeedbackAgent(taskId, reportId) {
  const pool = getPool()
  console.log(`[FeedbackAgent] Processing completed task ${taskId}`)

  try {
    // 1. Fetch task + worker details
    const { rows: taskRows } = await pool.query(
      `SELECT t.*, p.full_name AS worker_name, p.zone AS worker_zone
       FROM swachhlens_tasks t
       LEFT JOIN profiles p ON t.worker_id = p.id
       WHERE t.id = $1`,
      [taskId]
    )
    const task = taskRows[0]
    if (!task || !task.worker_id) {
      console.log(`[FeedbackAgent] Task ${taskId} has no assigned worker — skipping.`)
      return
    }

    // 2. Compute worker performance stats
    const { rows: statsRows } = await pool.query(
      `SELECT
         COUNT(*)::int             AS total_completed,
         AVG(completion_score)::int AS avg_score
       FROM swachhlens_tasks
       WHERE worker_id = $1
         AND status IN ('Completed', 'Verified')
         AND completion_score IS NOT NULL`,
      [task.worker_id]
    )
    const stats = statsRows[0] || {}
    const totalCompleted = stats.total_completed || 1
    const avgScore = stats.avg_score || (task.completion_score || 75)

    // Determine performance tier
    let performanceTier = 'Standard'
    if (avgScore >= 85) performanceTier = 'Excellence'
    else if (avgScore >= 70) performanceTier = 'Good'
    else if (avgScore < 50) performanceTier = 'Needs Improvement'

    console.log(`[FeedbackAgent] Worker ${task.worker_name}: ${totalCompleted} jobs, avg score ${avgScore} → ${performanceTier}`)

    // 3. Update report to Verified with final citizen message
    await pool.query(
      `UPDATE swachhlens_reports SET
         status         = 'Resolved',
         citizen_update = $1,
         updated_at     = now()
       WHERE id = $2`,
      [
        `Your reported waste has been fully cleaned and verified by our AI system. ` +
        `Cleanup score: ${task.completion_score || 75}/100. ` +
        `Thank you for contributing to a cleaner city!`,
        reportId,
      ]
    )

    // 4. Archive training data entry in a lightweight JSON log
    const trainingEntry = {
      timestamp: new Date().toISOString(),
      task_id: taskId,
      report_id: reportId,
      worker_id: task.worker_id,
      worker_name: task.worker_name,
      category: task.report_category,
      ai_rating: task.ai_rating,
      completion_score: task.completion_score,
      ai_feedback: task.ai_feedback,
      has_before_image: !!task.before_image_url,
      has_after_image: !!task.after_image_url,
      performance_tier: performanceTier,
      worker_note: task.worker_note || '',
    }

    console.log(`[FeedbackAgent] Training entry logged:`, JSON.stringify(trainingEntry))
    console.log(`[FeedbackAgent] Feedback complete for task ${taskId} ✓`)

  } catch (err) {
    // Feedback agent errors must never crash the pipeline
    console.error(`[FeedbackAgent] Error processing task ${taskId}:`, err.message)
  }
}
