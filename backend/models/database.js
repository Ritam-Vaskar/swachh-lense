import crypto from 'node:crypto'
import { Pool } from 'pg'
import { DEMO_ACCOUNTS, SCHEMA_SQL, SAMPLE_TASKS, SEED_REPORTS, SEED_MUNICIPALITIES, makeId } from './schema.js'
import { analyzeReport } from '../lib/ai.js'

// const connectionString = process.env.DATABASE_URL || 'postgres://swachhlens:swachhlens@localhost:5432/swachhlens'
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':')
  if (!salt || !hash) return false
  const next = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex'))
}

function parseColumns(columns) {
  if (!columns || columns === '*') return { all: true, fields: [], relations: [] }
  const tokens = String(columns).split(',').map((token) => token.trim()).filter(Boolean)
  const relations = []
  const fields = []
  for (const token of tokens) {
    const relationMatch = token.match(/^([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)\(\*\)$/)
    if (relationMatch) relations.push({ alias: relationMatch[1], table: relationMatch[2] })
    else if (token !== '*') fields.push(token)
  }
  return { all: tokens.includes('*'), fields, relations }
}

function relationSource(table, alias) {
  if (table === 'swachhlens_tasks') {
    if (alias === 'worker') return { table: 'profiles', foreignKey: 'worker_id' }
    if (alias === 'report') return { table: 'swachhlens_reports', foreignKey: 'report_id' }
  }
  if (table === 'swachhlens_reports' && alias === 'worker') {
    return { table: 'profiles', foreignKey: 'assigned_worker_id' }
  }
  return null
}

function projectRow(table, row, columns, relationMaps = {}) {
  const parsed = parseColumns(columns)
  const result = parsed.all ? { ...row } : {}
  for (const field of parsed.fields) result[field] = row[field]
  for (const relation of parsed.relations) {
    const source = relationSource(table, relation.alias)
    if (!source) continue
    const related = relationMaps[relation.alias] || null
    result[relation.alias] = related.get(row[source.foreignKey]) || null
  }
  return result
}

function safeTable(table) {
  const allowed = new Set(['app_users', 'profiles', 'swachhlens_reports', 'swachhlens_tasks', 'media_uploads', 'municipalities'])
  if (!allowed.has(table)) throw new Error(`Unsupported table: ${table}`)
  return table
}

function buildWhere(filters = []) {
  const clauses = []
  const params = []
  for (const filter of filters) {
    if (filter.type === 'eq') {
      params.push(filter.value)
      clauses.push(`${filter.field} = $${params.length}`)
    } else if (filter.type === 'in') {
      params.push(filter.values)
      clauses.push(`${filter.field} = ANY($${params.length})`)
    }
  }
  return { clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

async function ensureSchema() {
  await pool.query(SCHEMA_SQL)
  // Run migrations for columns added after initial schema creation
  const migrations = [
    `ALTER TABLE swachhlens_tasks ADD COLUMN IF NOT EXISTS ai_feedback text NOT NULL DEFAULT ''`,
    // Multi-tenant: add municipality columns to existing tables
    `ALTER TABLE swachhlens_reports ADD COLUMN IF NOT EXISTS municipality_id uuid REFERENCES municipalities(id) ON DELETE SET NULL`,
    `ALTER TABLE swachhlens_reports ADD COLUMN IF NOT EXISTS municipality_name text`,
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS municipality_id uuid REFERENCES municipalities(id) ON DELETE SET NULL`,
    // Allow superadmin role (safe no-op if constraint already correct)
    `ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check`,
    `ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('operator', 'worker', 'superadmin'))`,
    // Municipality table indexes
    `CREATE INDEX IF NOT EXISTS swachhlens_reports_municipality_idx ON swachhlens_reports(municipality_id)`,
    `CREATE INDEX IF NOT EXISTS profiles_municipality_idx ON profiles(municipality_id)`,
  ]
  for (const sql of migrations) {
    await pool.query(sql).catch((err) => {
      // Ignore benign errors (column already exists, constraint already exists)
      const msg = err.message || ''
      if (!msg.includes('already exists') && !msg.includes('does not exist')) {
        console.warn('[DB Migration]', msg)
      }
    })
  }
}

async function selectRows({ table, columns = '*', filters = [], order, head = false }) {
  table = safeTable(table)
  const { clause, params } = buildWhere(filters)
  if (head) {
    const countQuery = `SELECT COUNT(*)::int AS count FROM ${table} ${clause}`
    const { rows } = await pool.query(countQuery, params)
    return { data: null, count: rows[0]?.count || 0 }
  }

  const orderClause = order?.field ? `ORDER BY ${order.field} ${order.ascending === false ? 'DESC' : 'ASC'}` : ''
  const { rows } = await pool.query(`SELECT * FROM ${table} ${clause} ${orderClause}`, params)
  const parsed = parseColumns(columns)

  const relationMaps = {}
  for (const relation of parsed.relations) {
    const source = relationSource(table, relation.alias)
    if (!source) continue
    const ids = [...new Set(rows.map((row) => row[source.foreignKey]).filter(Boolean))]
    if (ids.length === 0) {
      relationMaps[relation.alias] = new Map()
      continue
    }
    const relatedRows = (await pool.query(`SELECT * FROM ${source.table} WHERE id = ANY($1)`, [ids])).rows
    relationMaps[relation.alias] = new Map(relatedRows.map((row) => [row.id, row]))
  }

  return { data: rows.map((row) => projectRow(table, row, columns, relationMaps)) }
}

async function insertRows({ table, payload, columns = '*' }) {
  table = safeTable(table)
  const rows = Array.isArray(payload) ? payload : [payload]
  const inserted = []
  for (const input of rows) {
    const normalized = { id: input.id || makeId(), ...input }
    const keys = Object.keys(normalized)
    const values = keys.map((key) => normalized[key])
    const placeholders = keys.map((_, index) => `$${index + 1}`)
    const { rows: result } = await pool.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values,
    )
    inserted.push(result[0])
  }
  return { data: inserted.map((row) => projectRow(table, row, columns)) }
}

async function updateRows({ table, filters = [], payload = {}, columns = '*' }) {
  table = safeTable(table)
  const updates = { ...payload }
  if ('updated_at' in updates || (table !== 'swachhlens_tasks' && table !== 'swachhlens_reports')) {
    updates.updated_at = updates.updated_at || new Date().toISOString()
  }
  const keys = Object.keys(updates)
  if (keys.length === 0) return { data: [] }

  // Build SET clause: $1 … $N
  const setClause = keys.map((key, index) => `${key} = $${index + 1}`).join(', ')
  const setValues = keys.map((key) => updates[key])

  // Build WHERE clause with params offset past the SET params: $(N+1), $(N+2) …
  const whereClauses = []
  const whereValues = []
  for (const filter of filters) {
    const pos = keys.length + whereValues.length + 1
    if (filter.type === 'eq') {
      whereValues.push(filter.value)
      whereClauses.push(`${filter.field} = $${pos}`)
    } else if (filter.type === 'in') {
      whereValues.push(filter.values)
      whereClauses.push(`${filter.field} = ANY($${pos})`)
    }
  }
  const whereClause = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const values = [...setValues, ...whereValues]

  const { rows } = await pool.query(`UPDATE ${table} SET ${setClause} ${whereClause} RETURNING *`, values)
  return { data: rows.map((row) => projectRow(table, row, columns)) }
}

async function deleteRows({ table, filters = [], columns = '*' }) {
  table = safeTable(table)
  const { clause, params } = buildWhere(filters)
  const { rows } = await pool.query(`DELETE FROM ${table} ${clause} RETURNING *`, params)
  return { data: rows.map((row) => projectRow(table, row, columns)) }
}

export async function queryDatabase(request) {
  const { table, action, columns = '*', filters = [], order = null, payload = null, selectOptions = {} } = request
  if (action === 'select') return selectRows({ table, columns, filters, order, head: Boolean(selectOptions.head) })
  if (action === 'insert') return insertRows({ table, payload, columns })
  if (action === 'update') return updateRows({ table, filters, payload, columns })
  if (action === 'delete') return deleteRows({ table, filters, columns })
  throw new Error(`Unsupported action: ${action}`)
}

async function getProfileByUserId(userId) {
  const { rows } = await pool.query('SELECT * FROM profiles WHERE id = $1 LIMIT 1', [userId])
  return rows[0] || null
}

function publicUser(user) {
  return { id: user.id, email: user.email, created_at: user.created_at }
}

export async function signUpUser({ email, password, role, full_name, phone, zone, latitude, longitude }) {
  const existing = await pool.query('SELECT * FROM app_users WHERE email = $1 LIMIT 1', [email])
  if (existing.rows[0]) throw new Error('An account with this email already exists.')

  const password_hash = hashPassword(password)
  const userId = makeId()
  await pool.query('INSERT INTO app_users (id, email, password_hash) VALUES ($1, $2, $3)', [userId, email, password_hash])
  await pool.query(
    'INSERT INTO profiles (id, role, full_name, phone, zone, latitude, longitude, is_available) VALUES ($1, $2, $3, $4, $5, $6, $7, true)',
    [userId, role || 'worker', full_name || email.split('@')[0], phone || '', zone || 'Central', latitude ?? null, longitude ?? null],
  )
  const user = { id: userId, email, created_at: new Date().toISOString() }
  return { user: publicUser(user), profile: await getProfileByUserId(userId) }
}

export async function ensureUser({ email, password, role, full_name, phone, zone, latitude, longitude, is_available = true, municipality_id = null }) {
  const existing = await pool.query('SELECT * FROM app_users WHERE email = $1 LIMIT 1', [email])
  if (existing.rows[0]) {
    const user = existing.rows[0]
    await pool.query(
      `UPDATE profiles SET 
         role = COALESCE($1, role), 
         full_name = COALESCE($2, full_name), 
         phone = COALESCE($3, phone), 
         zone = COALESCE($4, zone), 
         latitude = COALESCE($5, latitude), 
         longitude = COALESCE($6, longitude), 
         is_available = COALESCE($7, is_available) 
       WHERE id = $8`,
      [role, full_name, phone, zone, latitude, longitude, is_available, user.id],
    )
    const profile = await getProfileByUserId(user.id)
    return { user: publicUser(user), profile }
  }

  const password_hash = hashPassword(password)
  const userId = makeId()
  await pool.query('INSERT INTO app_users (id, email, password_hash) VALUES ($1, $2, $3)', [userId, email, password_hash])
  await pool.query(
    'INSERT INTO profiles (id, role, full_name, phone, zone, latitude, longitude, is_available, municipality_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [userId, role || 'worker', full_name || email.split('@')[0], phone || '', zone || 'Central', latitude ?? null, longitude ?? null, is_available, municipality_id || null],
  )
  const user = { id: userId, email, created_at: new Date().toISOString() }
  return { user: publicUser(user), profile: await getProfileByUserId(userId) }
}

export async function signInUser({ email, password }) {
  const { rows } = await pool.query('SELECT * FROM app_users WHERE email = $1 LIMIT 1', [email])
  const user = rows[0]
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new Error('Invalid login credentials')
  }
  return { user: publicUser(user), profile: await getProfileByUserId(user.id) }
}

async function seedUsersIfNeeded() {
  for (const account of DEMO_ACCOUNTS) {
    await ensureUser(account).catch((err) => {
      console.warn(`[SeedUsers] Note for ${account.email}:`, err.message)
    })
  }
}

export async function seedDatabaseIfNeeded() {
  await ensureSchema()
  const muniMap = await seedMunicipalitiesIfNeeded()
  await seedUsersIfNeeded(muniMap)

  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM swachhlens_reports')
  if (rows[0]?.count > 0) return false

  const profileLookup = new Map()
  const { rows: profiles } = await pool.query('SELECT * FROM profiles')
  for (const profile of profiles) profileLookup.set(profile.full_name, profile)

  for (let i = 0; i < SEED_REPORTS.length; i += 1) {
    const seed = SEED_REPORTS[i]
    const ai = analyzeReport({ description: seed.description, category: seed.category, hazard_flag: seed.hazard_flag })
    // First two Bengaluru reports start as Assigned; rest as New
    const status   = i < 2 ? 'Assigned' : 'New'
    const approval = i < 2 ? 'Approved' : ai.autoApproved ? 'Auto-approved' : 'Pending'
    const assignedWorker = i === 0 ? profileLookup.get('Green Squad A')
                          : i === 1 ? profileLookup.get('River Crew B')
                          : null

    // Resolve municipality for this seed report
    const muniSlug = seed.municipality || null
    const muniRow  = muniSlug ? muniMap.get(muniSlug) || null : null
    const muniId   = muniRow?.id   || null
    const muniName = muniRow?.name || null

    const reportId = makeId()
    await pool.query(
      `INSERT INTO swachhlens_reports (
        id, reference_code, category, location, zone, status, priority, severity_score, volume,
        hazard_flag, duplicate_count, confidence, description, resident_name, citizen_update,
        latitude, longitude, approval_status, ai_analysis, team_size, assigned_worker_id,
        municipality_id, municipality_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        reportId,
        `SL-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(2, 5)}`,
        seed.category,
        seed.location,
        seed.zone,
        status,
        ai.priority,
        ai.severity_score,
        seed.volume,
        seed.hazard_flag,
        seed.duplicate_count,
        ai.confidence,
        seed.description,
        seed.resident_name,
        status === 'Assigned'
          ? 'Crew dispatched and on the way.'
          : approval === 'Auto-approved'
            ? 'Report auto-approved and queued for worker assignment.'
            : 'Report received and awaiting operator review.',
        seed.latitude,
        seed.longitude,
        approval,
        JSON.stringify(ai),
        ai.team_size,
        assignedWorker?.id || null,
        muniId,
        muniName,
      ],
    )

    if (i < SAMPLE_TASKS.length && assignedWorker) {
      const task = SAMPLE_TASKS[i]
      const scheduled = new Date(Date.now() + (i === 0 ? 15 : 45) * 60000).toISOString()
      await pool.query(
        `INSERT INTO swachhlens_tasks (
          id, report_id, task_code, crew_name, vehicle, eta, status, scheduled_for, latitude, longitude, worker_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          makeId(),
          reportId,
          `TASK-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(2, 4)}`,
          task.crew_name,
          task.vehicle,
          task.eta,
          'Assigned',
          scheduled,
          seed.latitude,
          seed.longitude,
          assignedWorker.id,
        ],
      )
    }
  }

  return true
}

export function getPool() {
  return pool
}
