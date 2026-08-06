import { getPool } from '../models/database.js'

export async function runPriorityAgent(reportId) {
  const pool = getPool()

  // 1. Fetch the report
  const { rows } = await pool.query('SELECT * FROM swachhlens_reports WHERE id = $1', [reportId])
  const report = rows[0]

  if (!report) {
    console.error(`[PriorityAgent] Report ${reportId} not found.`)
    return
  }

  // 2. Extract base metrics
  const aiAnalysis = report.ai_analysis || {}
  const baseSeverity = aiAnalysis.severity_score || report.severity_score || 50
  const isHazard = aiAnalysis.hazard_flag || report.hazard_flag || false
  const duplicateCount = report.duplicate_count || 1
  const volume = aiAnalysis.volume || report.volume || 'Medium'
  const aiTeamSize = aiAnalysis.team_size || report.team_size || 1

  // 3. Calculate Final Severity Score
  // Boost score for multiple reports of the same issue
  let calculatedSeverity = baseSeverity + (duplicateCount - 1) * 5
  
  // Extra bump if there's a safety hazard
  if (isHazard) calculatedSeverity += 10

  // Cap at 100
  calculatedSeverity = Math.min(100, Math.max(1, calculatedSeverity))

  // 4. Assign Priority Band
  let priority = 'Low'
  if (calculatedSeverity >= 85) priority = 'Critical'
  else if (calculatedSeverity >= 65) priority = 'High'
  else if (calculatedSeverity >= 40) priority = 'Medium'

  // 5. Resource Planning
  let tools = ['Standard cleaning kit', 'Trash bags']
  if (isHazard) tools = ['PPE suits', 'Bio-hazard bags', 'Heavy gloves']
  else if (volume === 'Large' || volume === 'Overflowing') tools = ['Shovels', 'Wheelbarrow', 'Heavy duty brooms']

  let vehicle = 'Pushcart'
  if (aiTeamSize >= 4 || volume === 'Overflowing') vehicle = 'Compactor Truck'
  else if (aiTeamSize >= 2 || volume === 'Large') vehicle = 'Mini Tipper'

  const resourcePlan = {
    priority_score: calculatedSeverity,
    recommended_team_size: aiTeamSize,
    tools_required: tools,
    vehicle_type: vehicle,
    duplicate_count: duplicateCount
  }

  aiAnalysis.resource_plan = resourcePlan
  aiAnalysis.priority = priority
  aiAnalysis.severity_score = calculatedSeverity

  // 6. Update Database
  await pool.query(
    `UPDATE swachhlens_reports SET 
      severity_score = $1, 
      priority = $2, 
      ai_analysis = $3,
      updated_at = now()
     WHERE id = $4`,
    [calculatedSeverity, priority, JSON.stringify(aiAnalysis), reportId]
  )

  console.log(`[PriorityAgent] Report ${reportId} planned: Priority ${priority} (${calculatedSeverity}/100), Team: ${aiTeamSize}, Vehicle: ${vehicle}`)

  // 7. Chain to Dispatch Agent
  chainToDispatchAgent(reportId)
}

function chainToDispatchAgent(reportId) {
  setImmediate(async () => {
    try {
      const { runDispatchAgent } = await import('./dispatchAgent.js')
      await runDispatchAgent(reportId)
    } catch (err) {
      // It's expected to fail here if Phase 5 (Dispatch) isn't built yet
      console.log(`[PriorityAgent] Finished pipeline (Dispatch Agent not yet implemented)`)
    }
  })
}
