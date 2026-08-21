import crypto from 'node:crypto'
import { getPool } from '../models/database.js'
import { checkMunicipalityAvailability } from '../lib/municipalityResolver.js'

function makeId() {
  return crypto.randomUUID()
}

function generateReferenceCode() {
  return `SL-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(2, 5)}`
}

function generateTaskCode() {
  return `TASK-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(2, 4)}`
}

/**
 * Validate the incoming submission body.
 * Returns { valid: true } or { valid: false, error: string }
 */
function validateSubmission(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required.' }
  }

  const { location, resident_name, description, category } = body

  if (!location?.trim() && !(body.latitude != null && body.longitude != null)) {
    return { valid: false, error: 'Either a location description or GPS coordinates are required.' }
  }

  if (!description?.trim() && !body.image_url?.trim()) {
    return { valid: false, error: 'A description or photo is required to submit a report.' }
  }

  if (!category?.trim()) {
    return { valid: false, error: 'A waste category is required.' }
  }

  return { valid: true }
}

/**
 * Main intake handler.
 * Called by the intake route. Performs double validation:
 * 1. Coordinates validation
 * 2. Municipality registered & active check
 * 3. Municipality worker availability check
 * 4. Assigns nearest worker from THAT municipality
 */
export async function runIntakeAgent(body) {
  // Step 1: Input Validation
  const validation = validateSubmission(body)
  if (!validation.valid) {
    return { success: false, error: validation.error }
  }

  const pool = getPool()
  let assignedMuni = null
  let assignedWorker = null

  // Step 2: Validate GPS & Service Availability (Rapido model)
  if (body.latitude != null && body.longitude != null) {
    const availability = await checkMunicipalityAvailability(body.latitude, body.longitude)
    if (!availability.available) {
      return {
        success: false,
        reason: availability.reason,
        error: availability.message,
      }
    }
    assignedMuni = availability.municipality
    assignedWorker = availability.nearestWorker
  } else if (body.municipality_id) {
    // Operator fallback when municipality_id is explicitly given
    const { rows: munis } = await pool.query('SELECT * FROM municipalities WHERE id = $1 AND is_active = true LIMIT 1', [body.municipality_id])
    if (munis[0]) {
      assignedMuni = munis[0]
      const { rows: workers } = await pool.query('SELECT * FROM profiles WHERE municipality_id = $1 AND is_available = true AND role = \'worker\' LIMIT 1', [body.municipality_id])
      assignedWorker = workers[0] || null
    }
  }

  // If this was a citizen report with no valid active municipality coverage, reject
  if (!assignedMuni && body.source !== 'operator') {
    return {
      success: false,
      reason: 'MUNICIPALITY_NOT_REGISTERED',
      error: 'This service is not available in your municipal area yet.',
    }
  }

  const id = makeId()
  const referenceCode = generateReferenceCode()

  const {
    category,
    location,
    zone = assignedWorker?.zone || 'Central',
    latitude = null,
    longitude = null,
    volume = 'Medium',
    hazard_flag = false,
    description = '',
    resident_name = 'Citizen',
    citizen_phone = '',
    image_url = null,
  } = body

  const status = assignedWorker ? 'Assigned' : 'New'
  const citizenUpdate = assignedWorker
    ? 'Crew dispatched and on the way.'
    : body.ai_analysis?.autoApproved
      ? 'Report auto-approved and queued for assignment.'
      : 'Report received and queued for review.'

  try {
    const { rows } = await pool.query(
      `INSERT INTO swachhlens_reports (
         id, reference_code, category, location, zone,
         latitude, longitude, volume, hazard_flag, description,
         resident_name, citizen_phone, image_url, status, approval_status,
         citizen_update, priority, severity_score, confidence, team_size,
         duplicate_count, ai_analysis, municipality_id, municipality_name,
         assigned_worker_id, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,
         1,$21,$22,$23,$24,now(),now()
       ) RETURNING *`,
      [
        id,
        referenceCode,
        category,
        (location || `GPS ${latitude?.toFixed(4)}, ${longitude?.toFixed(4)}`).trim(),
        zone,
        latitude,
        longitude,
        volume,
        hazard_flag,
        description,
        resident_name || 'Citizen',
        citizen_phone || '',
        image_url || null,
        status,
        body.ai_analysis?.autoApproved ? 'Auto-approved' : 'Pending',
        citizenUpdate,
        body.ai_analysis?.priority || 'Medium',
        body.ai_analysis?.severity_score || 50,
        body.ai_analysis?.confidence || 90,
        body.ai_analysis?.team_size || 1,
        body.ai_analysis ? JSON.stringify(body.ai_analysis) : null,
        assignedMuni?.id || null,
        assignedMuni?.name || null,
        assignedWorker?.id || null,
      ],
    )

    const report = rows[0]

    // Create task for assigned worker immediately
    if (assignedWorker) {
      const scheduledFor = new Date(Date.now() + 25 * 60000).toISOString()
      await pool.query(
        `INSERT INTO swachhlens_tasks (
           id, report_id, task_code, crew_name, vehicle, eta, status, scheduled_for, latitude, longitude, worker_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          makeId(),
          report.id,
          generateTaskCode(),
          assignedWorker.full_name || 'Assigned Squad',
          'Mini Tipper',
          '25 min',
          'Assigned',
          scheduledFor,
          latitude,
          longitude,
          assignedWorker.id,
        ],
      )
    }

    // Step 3: Run asynchronous agents
    setImmediate(async () => {
      try {
        const { runCorrelationAgent } = await import('./correlationAgent.js')
        await runCorrelationAgent(report.id)
      } catch { }
      try {
        const { runApprovalAgent } = await import('./approvalAgent.js')
        if (body.ai_analysis?.autoApproved) await runApprovalAgent(report.id, 'auto')
      } catch { }
    })

    return {
      success: true,
      report,
      municipality: assignedMuni,
      assignedWorker,
      message: assignedWorker
        ? `Report assigned to ${assignedWorker.full_name} (${assignedMuni?.name || ''}).`
        : 'Report received.',
    }
  } catch (err) {
    console.error('[IntakeAgent] DB error creating report:', err)
    return { success: false, error: 'Could not save report. Please try again.' }
  }
}

