/**
 * municipalityResolver.js
 *
 * Resolves a GPS coordinate pair (lat, lng) to an ALREADY-REGISTERED municipality row
 * in the `municipalities` table.
 *
 * STRICT RAPIDO-STYLE RULE:
 *   - Does NOT create municipalities automatically under any circumstances.
 *   - Only queries existing, active municipalities (is_active = true).
 *   - If coordinates fall outside any registered & active municipality, returns null.
 */

import { getPool } from '../models/database.js'

// ---------------------------------------------------------------------------
// Constants & Distance Helper
// ---------------------------------------------------------------------------

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const USER_AGENT   = 'SwachhLens/1.0 (contact@swachhlens.in)'
const TIMEOUT_MS   = 10_000   // 10 s

const ADDR_KEYS_MUNICIPALITY = [
  'city',
  'town',
  'municipality',
  'city_district',
  'county',
  'state_district',
  'district',
  'suburb',
  'village',
]

export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371 // Earth radius in km
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

function validateCoords(lat, lng) {
  const la = parseFloat(lat)
  const lo = parseFloat(lng)
  return (
    Number.isFinite(la) && Number.isFinite(lo) &&
    la >= -90 && la <= 90 &&
    lo >= -180 && lo <= 180
  )
}

function extractMunicipalityName(address) {
  if (!address || typeof address !== 'object') return null
  for (const key of ADDR_KEYS_MUNICIPALITY) {
    const val = address[key]
    if (val && typeof val === 'string' && val.trim().length > 1) {
      return val.trim()
    }
  }
  return null
}

async function callNominatim(lat, lng) {
  const params = new URLSearchParams({
    format:         'json',
    lat:            String(lat),
    lon:            String(lng),
    zoom:           '10',
    addressdetails: '1',
  })

  const url = `${NOMINATIM_URL}?${params.toString()}`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept':     'application/json',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) return null
    const data = await response.json()
    if (data.error) return null
    return data.address || null
  } catch (err) {
    console.warn(`[MuniResolver] Nominatim fetch failed for (${lat}, ${lng}): ${err.message}`)
    return null
  }
}

/**
 * Find an ACTIVE municipality in the database.
 * Matches by slug, name, city, or geographical proximity to municipality center (< 40km).
 */
export async function resolveMunicipality(lat, lng) {
  if (!validateCoords(lat, lng)) {
    console.warn(`[MuniResolver] Invalid coordinates: (${lat}, ${lng})`)
    return null
  }

  const pool = getPool()
  const la = parseFloat(lat)
  const lo = parseFloat(lng)

  // 1. Try reverse geocoding via Nominatim
  const address = await callNominatim(la, lo)
  const rawName = extractMunicipalityName(address)

  if (rawName) {
    const slug = slugify(rawName)
    const { rows } = await pool.query(
      `SELECT * FROM municipalities 
       WHERE (slug = $1 OR LOWER(name) = LOWER($2) OR LOWER(city) = LOWER($2) OR name ILIKE $3 OR city ILIKE $3)
         AND is_active = true 
       LIMIT 1`,
      [slug, rawName, `%${rawName}%`]
    )
    if (rows[0]) return rows[0]
  }

  // 2. Spatial proximity fallback: find closest active municipality within 40 km radius
  const { rows: allActive } = await pool.query(
    `SELECT * FROM municipalities WHERE is_active = true AND lat_center IS NOT NULL AND lng_center IS NOT NULL`
  )

  let closestMuni = null
  let minDistance = 40 // Maximum 40km boundary radius

  for (const m of allActive) {
    const dist = haversineDistanceKm(la, lo, m.lat_center, m.lng_center)
    if (dist < minDistance) {
      minDistance = dist
      closestMuni = m
    }
  }

  if (closestMuni) {
    return closestMuni
  }

  // Strictly return null if no registered active municipality covers this location
  return null
}

/**
 * Check service availability and workers for a GPS location.
 *
 * @returns {Promise<{
 *   available: boolean,
 *   reason?: 'MUNICIPALITY_NOT_REGISTERED' | 'NO_WORKER_AVAILABLE',
 *   message?: string,
 *   municipality?: object,
 *   workerAvailable?: boolean,
 *   availableWorkersCount?: number,
 *   nearestWorker?: object
 * }>}
 */
export async function checkMunicipalityAvailability(lat, lng) {
  if (!validateCoords(lat, lng)) {
    return {
      available: false,
      reason: 'MUNICIPALITY_NOT_REGISTERED',
      message: 'Invalid GPS coordinates provided.',
    }
  }

  const muni = await resolveMunicipality(lat, lng)

  if (!muni) {
    return {
      available: false,
      reason: 'MUNICIPALITY_NOT_REGISTERED',
      message: 'This service is not available in your municipal area yet.',
    }
  }

  const pool = getPool()
  // Query available workers strictly scoped to this municipality
  const { rows: workers } = await pool.query(
    `SELECT p.*, au.email FROM profiles p
     JOIN app_users au ON p.id = au.id
     WHERE p.role = 'worker' 
       AND p.is_available = true 
       AND p.municipality_id = $1`,
    [muni.id]
  )

  if (workers.length === 0) {
    return {
      available: false,
      reason: 'NO_WORKER_AVAILABLE',
      message: 'No service team is currently available in your municipal area.',
      municipality: { id: muni.id, name: muni.name, city: muni.city, state: muni.state },
      workerAvailable: false,
      availableWorkersCount: 0,
    }
  }

  // Calculate distance for all available workers in this municipality
  const la = parseFloat(lat)
  const lo = parseFloat(lng)
  const scoredWorkers = workers.map((w) => {
    const distKm = (w.latitude != null && w.longitude != null)
      ? haversineDistanceKm(la, lo, w.latitude, w.longitude)
      : 9999
    return { worker: w, distKm }
  })

  scoredWorkers.sort((a, b) => a.distKm - b.distKm)
  const nearestWorker = scoredWorkers[0]?.worker || workers[0]

  return {
    available: true,
    municipality: { id: muni.id, name: muni.name, city: muni.city, state: muni.state },
    workerAvailable: true,
    availableWorkersCount: workers.length,
    nearestWorker,
  }
}

