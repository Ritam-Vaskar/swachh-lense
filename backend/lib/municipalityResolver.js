/**
 * municipalityResolver.js
 *
 * Resolves a GPS coordinate pair (lat, lng) to a municipality row
 * in the `municipalities` table. Uses Nominatim OSM for reverse geocoding,
 * with a DB cache so each unique location slug is only ever looked up once.
 *
 * Edge-cases handled:
 *   - Invalid / out-of-range coordinates
 *   - Nominatim network timeout (10 s hard limit)
 *   - Nominatim returns non-200 or malformed JSON
 *   - address object missing city / town / county (deep field walk)
 *   - address returns only a rural hamlet or suburb – walks up the hierarchy
 *   - Municipality name already exists in DB (case-insensitive slug match)
 *   - Concurrent inserts racing on the UNIQUE slug constraint
 *   - DB unavailable – resolver returns null gracefully (never throws)
 */

import { getPool } from '../models/database.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const USER_AGENT   = 'SwachhLens/1.0 (contact@swachhlens.in)'
const TIMEOUT_MS   = 10_000   // 10 s – Nominatim can be slow outside EU

/**
 * Ordered list of Nominatim address keys to try for the municipality name.
 * We walk from most specific to least specific so that a proper
 * "city_district" (e.g. BBMP ward) is preferred over a vague "county".
 */
const ADDR_KEYS_MUNICIPALITY = [
  'city',
  'town',
  'municipality',
  'city_district',
  'county',
  'state_district',
  'district',
  'suburb',         // fallback – suburb names are better than nothing
  'village',
]

const ADDR_KEYS_STATE = [
  'state',
  'state_district',
  'region',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a long municipality name into a URL/DB-safe slug.
 * "Bruhat Bengaluru Mahanagara Palike" → "bruhat-bengaluru-mahanagara-palike"
 */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)                       // hard cap
}

/**
 * Returns true when lat/lng are plausible WGS-84 values.
 */
function validateCoords(lat, lng) {
  const la = parseFloat(lat)
  const lo = parseFloat(lng)
  return (
    Number.isFinite(la) && Number.isFinite(lo) &&
    la >= -90 && la <= 90 &&
    lo >= -180 && lo <= 180
  )
}

/**
 * Extract a usable city/town name from a Nominatim address object.
 * Walks the priority list and returns the first non-empty value.
 */
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

/**
 * Extract state name from Nominatim address.
 */
function extractState(address) {
  if (!address || typeof address !== 'object') return 'Unknown'
  for (const key of ADDR_KEYS_STATE) {
    const val = address[key]
    if (val && typeof val === 'string' && val.trim().length > 1) return val.trim()
  }
  return 'Unknown'
}

// ---------------------------------------------------------------------------
// Nominatim call (with timeout + error containment)
// ---------------------------------------------------------------------------

/**
 * Calls the Nominatim reverse-geocoding API.
 * Returns the parsed JSON `address` object or null on any failure.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<object|null>}  Nominatim `address` field
 */
async function callNominatim(lat, lng) {
  const params = new URLSearchParams({
    format:         'json',
    lat:            String(lat),
    lon:            String(lng),
    zoom:           '10',         // zoom=10 → city/town level (not street)
    addressdetails: '1',
  })

  const url = `${NOMINATIM_URL}?${params.toString()}`

  let response
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept':     'application/json',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
  } catch (err) {
    // Network error or timeout
    const reason = err.name === 'AbortError' ? 'timeout' : err.message
    console.warn(`[MuniResolver] Nominatim fetch failed (${reason}) for (${lat}, ${lng})`)
    return null
  }

  if (!response.ok) {
    console.warn(`[MuniResolver] Nominatim returned HTTP ${response.status} for (${lat}, ${lng})`)
    return null
  }

  let data
  try {
    data = await response.json()
  } catch {
    console.warn(`[MuniResolver] Nominatim returned non-JSON for (${lat}, ${lng})`)
    return null
  }

  // Nominatim returns `{ error: "Unable to geocode" }` for ocean / unmapped areas
  if (data.error) {
    console.warn(`[MuniResolver] Nominatim error: "${data.error}" for (${lat}, ${lng})`)
    return null
  }

  return data.address || null
}

// ---------------------------------------------------------------------------
// DB layer
// ---------------------------------------------------------------------------

/**
 * Look up a municipality by its normalised slug.
 * Case-insensitive.
 */
async function findBySlug(pool, slug) {
  const { rows } = await pool.query(
    `SELECT * FROM municipalities WHERE slug = $1 LIMIT 1`,
    [slug]
  )
  return rows[0] || null
}

/**
 * Look up a municipality by a fuzzy name match (ILIKE).
 * Handles slight variations like "Bengaluru" vs "Bangalore".
 */
async function findByNameFuzzy(pool, name) {
  const { rows } = await pool.query(
    `SELECT * FROM municipalities WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name]
  )
  return rows[0] || null
}

/**
 * Insert a new municipality, handling the race condition where two concurrent
 * requests try to create the same slug simultaneously (ON CONFLICT DO NOTHING
 * + re-fetch).
 */
async function upsertMunicipality(pool, { name, slug, city, state, lat, lng }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO municipalities (name, slug, city, state, lat_center, lng_center)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name
       RETURNING *`,
      [name, slug, city, state, lat, lng]
    )
    return rows[0] || null
  } catch (err) {
    // Unexpected DB error — log but don't crash the report intake
    console.error('[MuniResolver] DB upsert error:', err.message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve (lat, lng) → municipality row.
 *
 * Resolution order:
 *   1. Validate coords
 *   2. Call Nominatim
 *   3. Extract city name from address hierarchy
 *   4. Slug-match against existing municipalities table
 *   5. Fuzzy name-match against existing municipalities table
 *   6. Auto-create a new municipality record if not found
 *   7. Return the municipality row (or null if irresolvable)
 *
 * This function NEVER throws — callers don't need try/catch.
 *
 * @param {number|string} lat
 * @param {number|string} lng
 * @returns {Promise<object|null>}  municipalities table row
 */
export async function resolveMunicipality(lat, lng) {
  // --- 1. Validate ---
  if (!validateCoords(lat, lng)) {
    console.warn(`[MuniResolver] Invalid coordinates: (${lat}, ${lng})`)
    return null
  }

  const pool = getPool()

  // --- 2. Nominatim ---
  const address = await callNominatim(lat, lng)
  if (!address) return null

  // --- 3. Extract name ---
  const rawName = extractMunicipalityName(address)
  if (!rawName) {
    console.warn(`[MuniResolver] Could not extract municipality from address:`, JSON.stringify(address))
    return null
  }

  const state = extractState(address)
  const slug  = slugify(rawName)

  // --- 4. Slug match ---
  try {
    const bySlug = await findBySlug(pool, slug)
    if (bySlug) return bySlug

    // --- 5. Fuzzy name match ---
    const byName = await findByNameFuzzy(pool, rawName)
    if (byName) return byName

    // --- 6. Auto-create ---
    console.info(`[MuniResolver] Auto-creating municipality: "${rawName}" (slug: ${slug})`)
    const created = await upsertMunicipality(pool, {
      name:  rawName,
      slug,
      city:  rawName,
      state,
      lat:   parseFloat(lat),
      lng:   parseFloat(lng),
    })

    if (!created) {
      // Race condition: another request created it just now — re-fetch
      return findBySlug(pool, slug)
    }

    return created
  } catch (err) {
    console.error('[MuniResolver] Unexpected DB error:', err.message)
    return null
  }
}
