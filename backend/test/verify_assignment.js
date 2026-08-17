import 'dotenv/config'
import { getPool, seedDatabaseIfNeeded, signUpUser } from '../models/database.js'
import { runIntakeAgent } from '../agents/intakeAgent.js'

async function runTest() {
  console.log('--- Starting Proximity Assignment Verification ---')
  await seedDatabaseIfNeeded()
  const pool = getPool()

  // 1. Ensure existing test user msd@squad.local is removed if present
  await pool.query("DELETE FROM app_users WHERE email = 'msd@squad.local'")

  // 2. Sign up worker in Murshidabad
  console.log('\nStep 1: Signing up worker in Murshidabad (msd@squad.local)...')
  const murshidabadLat = 24.1750
  const murshidabadLng = 88.2800

  const signupResult = await signUpUser({
    email: 'msd@squad.local',
    password: 'Password123!',
    role: 'worker',
    full_name: 'Murshidabad Squad',
    phone: '+91 98765 43210',
    zone: 'East',
    latitude: murshidabadLat,
    longitude: murshidabadLng,
  })

  console.log('Worker registered successfully:', {
    id: signupResult.profile.id,
    full_name: signupResult.profile.full_name,
    latitude: signupResult.profile.latitude,
    longitude: signupResult.profile.longitude,
  })

  if (signupResult.profile.latitude !== murshidabadLat || signupResult.profile.longitude !== murshidabadLng) {
    throw new Error('Worker latitude/longitude was not persisted in database!')
  }

  // 3. Create an Illegal Dumpsite report in Murshidabad
  console.log('\nStep 2: Submitting an Illegal Dumpsite report in Murshidabad...')
  const reportLat = 24.1755
  const reportLng = 88.2805

  const intakeResult = await runIntakeAgent({
    category: 'Illegal dumpsite',
    location: 'Murshidabad Market area',
    zone: 'Central', // default zone
    latitude: reportLat,
    longitude: reportLng,
    description: 'Large illegal garbage pile near Murshidabad station',
    resident_name: 'Local Citizen',
    citizen_phone: '+91 91234 56789',
    image_url: null,
    source: 'citizen',
    ai_analysis: {
      category: 'Illegal dumpsite',
      severity_score: 60,
      priority: 'Medium',
      confidence: 90,
      team_size: 2,
    },
  })

  const reportId = intakeResult.report.id
  console.log(`Report created with ID ${reportId}, reference ${intakeResult.report.reference_code}`)

  // 4. Wait a moment for async correlation -> priority -> dispatch pipeline to complete
  console.log('\nStep 3: Waiting for agent pipeline execution...')
  await new Promise((resolve) => setTimeout(resolve, 1500))

  // 5. Check report and task assignment in DB
  const { rows: reportRows } = await pool.query(
    `SELECT r.*, p.full_name AS assigned_worker_name, au.email AS assigned_worker_email 
     FROM swachhlens_reports r 
     LEFT JOIN profiles p ON r.assigned_worker_id = p.id 
     LEFT JOIN app_users au ON p.id = au.id
     WHERE r.id = $1`,
    [reportId]
  )
  const finalReport = reportRows[0]

  const { rows: taskRows } = await pool.query(
    `SELECT * FROM swachhlens_tasks WHERE report_id = $1`,
    [reportId]
  )
  const task = taskRows[0]

  console.log('\n--- Final Verification Results ---')
  console.log('Report Status:', finalReport?.status)
  console.log('Report Approval Status:', finalReport?.approval_status)
  console.log('Assigned Worker Name:', finalReport?.assigned_worker_name)
  console.log('Assigned Worker Email:', finalReport?.assigned_worker_email)
  console.log('Task Created:', task ? { code: task.task_code, crew: task.crew_name, eta: task.eta, status: task.status } : 'NO TASK')

  if (finalReport?.status === 'Duplicate') {
    throw new Error('FAIL: Report was incorrectly classified as Duplicate by Correlation Agent!')
  }

  if (finalReport?.assigned_worker_email !== 'msd@squad.local') {
    throw new Error(`FAIL: Expected assignment to msd@squad.local (Murshidabad Squad), but got ${finalReport?.assigned_worker_name} (${finalReport?.assigned_worker_email})`)
  }

  console.log('\n✅ SUCCESS: Murshidabad Illegal Dump was correctly assigned to nearest squad (Murshidabad Squad / msd@squad.local)!')
  process.exit(0)
}

runTest().catch((err) => {
  console.error('\n❌ Test Error:', err)
  process.exit(1)
})
