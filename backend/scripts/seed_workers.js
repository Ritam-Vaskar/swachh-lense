import 'dotenv/config'
import { getPool, seedDatabaseIfNeeded, ensureUser } from '../models/database.js'
import { DEMO_ACCOUNTS } from '../models/schema.js'

async function run() {
  console.log('🌱 Starting Data Seeding & Accounts Check...\n')
  
  await seedDatabaseIfNeeded()
  const pool = getPool()

  const { rows: users } = await pool.query(
    `SELECT p.id, p.full_name, au.email, p.role, p.zone, p.latitude, p.longitude, p.phone, p.is_available, m.name AS municipality_name
     FROM profiles p
     JOIN app_users au ON p.id = au.id
     LEFT JOIN municipalities m ON p.municipality_id = m.id
     ORDER BY p.role DESC, p.full_name ASC`
  )

  console.log('================================================================================')
  console.log('                 SWACHHLENS ROLES & ACCOUNTS OVERVIEW                           ')
  console.log('================================================================================')

  const superadmins = users.filter(u => u.role === 'superadmin')
  const operators = users.filter(u => u.role === 'operator')
  const workers = users.filter(u => u.role === 'worker')

  console.log('\n👑 SUPER ADMIN ACCOUNTS (National Jurisdiction - All Municipalities):')
  console.table(superadmins.map(u => ({
    'Name': u.full_name,
    'Email': u.email,
    'Role': u.role,
    'Access': 'All Municipalities (National)',
    'Phone': u.phone
  })))

  console.log('\n🏛️ MUNICIPALITY OPERATOR DESKS (Scoped by Municipality):')
  console.table(operators.map(u => ({
    'Desk Name': u.full_name,
    'Email': u.email,
    'Role': u.role,
    'Assigned Municipality': u.municipality_name || 'BBMP (Bengaluru)',
    'Zone': u.zone
  })))

  console.log('\n👷 FIELD WORKER SQUADS:')
  console.table(workers.map(w => ({
    'Squad Name': w.full_name,
    'Email': w.email,
    'Municipality': w.municipality_name || 'Unassigned',
    'Zone': w.zone,
    'Status': w.is_available ? 'Available' : 'Busy'
  })))

  console.log(`\n✅ Total Accounts Active in Database: ${users.length} (${superadmins.length} Super Admin, ${operators.length} Operators, ${workers.length} Workers)`)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Seeding failed:', err)
  process.exit(1)
})
