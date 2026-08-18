import 'dotenv/config'
import { getPool, seedDatabaseIfNeeded, ensureUser } from '../models/database.js'
import { DEMO_ACCOUNTS } from '../models/schema.js'

async function run() {
  console.log('🌱 Starting Worker Data Seeding for Kolkata & Bhubaneswar...\n')
  
  await seedDatabaseIfNeeded()
  const pool = getPool()

  for (const account of DEMO_ACCOUNTS) {
    await ensureUser(account)
  }

  const { rows: workers } = await pool.query(
    `SELECT p.id, p.full_name, au.email, p.role, p.zone, p.latitude, p.longitude, p.phone, p.is_available
     FROM profiles p
     JOIN app_users au ON p.id = au.id
     WHERE p.role = 'worker'
     ORDER BY p.full_name ASC`
  )

  console.log('================================================================================')
  console.log('                 SWACHHLENS WORKER FLEET - SEEDED PROFILES                      ')
  console.log('================================================================================')

  const kolkataWorkers = workers.filter(w => w.email.includes('kolkata'))
  const bbsrWorkers = workers.filter(w => w.email.includes('bbsr'))
  const otherWorkers = workers.filter(w => !w.email.includes('kolkata') && !w.email.includes('bbsr'))

  console.log('\n📍 KOLKATA SQUADS (West Bengal):')
  console.table(kolkataWorkers.map(w => ({
    'Squad Name': w.full_name,
    'Email': w.email,
    'Zone': w.zone,
    'Latitude': w.latitude,
    'Longitude': w.longitude,
    'Phone': w.phone,
    'Status': w.is_available ? 'Available' : 'Busy'
  })))

  console.log('\n📍 BHUBANESWAR SQUADS (Odisha):')
  console.table(bbsrWorkers.map(w => ({
    'Squad Name': w.full_name,
    'Email': w.email,
    'Zone': w.zone,
    'Latitude': w.latitude,
    'Longitude': w.longitude,
    'Phone': w.phone,
    'Status': w.is_available ? 'Available' : 'Busy'
  })))

  if (otherWorkers.length > 0) {
    console.log('\n📍 OTHER REGISTERED SQUADS:')
    console.table(otherWorkers.map(w => ({
      'Squad Name': w.full_name,
      'Email': w.email,
      'Zone': w.zone,
      'Latitude': w.latitude,
      'Longitude': w.longitude,
      'Phone': w.phone,
      'Status': w.is_available ? 'Available' : 'Busy'
    })))
  }

  console.log(`\n✅ Total Workers Active in Database: ${workers.length}`)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Seeding failed:', err)
  process.exit(1)
})
