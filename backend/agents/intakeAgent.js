/**
 * Intake Agent — Phase 1
 *
 * Responsibilities:
 * 1. Validate the incoming report submission (required fields, GPS, etc.)
 * 2. Persist a validated complaint record with status: 'New'
 * 3. Fire the Vision Analysis Agent asynchronously (non-blocking)
 *
 * This agent is the entry point for ALL report submissions (citizen + operator).
 */

import crypto from 'node:crypto'
import { getPool } from '../models/database.js'

function makeId() {
  return crypto.randomUUID()
}

function generateReferenceCode() {
  return `SL-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(2, 5)}`
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

  if (!location?.trim() && !(body.latitude && body.longitude)) {
    return { valid: false, error: 'Either a location description or GPS coordinates are required.' }
  }

  if (!resident_name?.trim() && !body.phone?.trim()) {
    // Allow anonymous reports — just note them
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
 * Persist the report record to the database.
 * Returns the inserted report row.
 */
async function createReportRecord(data) {
  const pool = getPool()
  const id = makeId()
  const referenceCode = generateReferenceCode()

  const {
    category,
    location,
    zone = 'Central',
    latitude = null,
    longitude = null,
    volume = 'Medium',
    hazard_flag = false,
    description = '',
    resident_name = 'Citizen',
    citizen_phone = '',
    image_url = null,
    source = 'citizen', // 'citizen' | 'operator'
  } = data

  const citizenUpdate = 'Report received and queued for AI analysis.'

    const { rows } = await pool.query(
    `INSERT INTO swachhlens_reports (
       id, reference_code, category, location, zone,
       latitude, longitude, volume, hazard_flag, description,
       resident_name, citizen_phone, image_url, status, approval_status,
       citizen_update, priority, severity_score, confidence, team_size,
       duplicate_count, ai_analysis, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,
       $6,$7,$8,$9,$10,
       $11,$12,$13,'New',$14,
       $15,$16,$17,$18,$19,
       1,$20,now(),now()
     ) RETURNING *`,
    [
      id, referenceCode, category, (location || `GPS ${latitude?.toFixed(4)}, ${longitude?.toFixed(4)}`).trim(), zone,
      latitude, longitude, volume, hazard_flag, description,
      resident_name || 'Citizen', citizen_phone || '', image_url || null,
      data.ai_analysis?.autoApproved ? 'Auto-approved' : 'Pending',
      citizenUpdate, data.ai_analysis?.priority || 'Medium', data.ai_analysis?.severity_score || 50, 
      data.ai_analysis?.confidence || 0, data.ai_analysis?.team_size || 1, data.ai_analysis ? JSON.stringify(data.ai_analysis) : null
    ],
  )

  return rows[0]
}

/**
 * Main intake handler.
 * Called by the intake route. Returns the created report or an error.
 */
export async function runIntakeAgent(body) {
  // Step 1: Validate
  const validation = validateSubmission(body)
  if (!validation.valid) {
    return { success: false, error: validation.error }
  }

  // Step 2: Create the initial record (status: New, no AI analysis yet)
  let report
  try {
    report = await createReportRecord(body)
  } catch (err) {
    console.error('[IntakeAgent] DB error creating report:', err.message)
    return { success: false, error: 'Could not save report. Please try again.' }
  }

  // Step 3: Chain to Correlation Agent + Priority Agent (Phase 3/4)
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
    message: 'Report received and verified.',
  }
}
