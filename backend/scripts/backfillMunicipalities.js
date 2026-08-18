#!/usr/bin/env node
/**
 * backfillMunicipalities.js
 *
 * One-shot script to retroactively assign municipality_id to every report
 * in swachhlens_reports that has GPS coordinates but no municipality_id.
 *
 * Run: node backend/scripts/backfillMunicipalities.js
 */

import 'dotenv/config'
import { getPool } from '../models/database.js'
import { resolveMunicipality } from '../lib/municipalityResolver.js'

const DELAY_MS = 1100 // Nominatim rate limit: 1 req/s

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const pool = getPool()

  const { rows: targets } = await pool.query(`
    SELECT id, latitude, longitude, reference_code
    FROM swachhlens_reports
    WHERE municipality_id IS NULL
      AND latitude  IS NOT NULL
      AND longitude IS NOT NULL
    ORDER BY created_at ASC
  `)

  if (targets.length === 0) {
    console.log('[Backfill] No unassigned reports found. Nothing to do.')
    process.exit(0)
  }

  console.log(`[Backfill] Found ${targets.length} report(s) to process.`)

  let success = 0
  let failed  = 0
  let skipped = 0

  for (let i = 0; i < targets.length; i++) {
    const { id, latitude, longitude, reference_code } = targets[i]
    process.stdout.write(`[Backfill] (${i + 1}/${targets.length}) ${reference_code} @ (${latitude}, ${longitude}) -> `)

    try {
      const muni = await resolveMunicipality(latitude, longitude)
      if (!muni) {
        console.log('no municipality resolved -- skipped')
        skipped++
      } else {
        await pool.query(
          `UPDATE swachhlens_reports
           SET municipality_id = $1, municipality_name = $2, updated_at = now()
           WHERE id = $3 AND municipality_id IS NULL`,
          [muni.id, muni.name, id]
        )
        console.log(`OK: ${muni.name} (${muni.slug})`)
        success++
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
      failed++
    }

    // Respect Nominatim's 1 req/s rate limit
    if (i < targets.length - 1) await sleep(DELAY_MS)
  }

  console.log(`\n[Backfill] Done. Success: ${success}  Skipped: ${skipped}  Failed: ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('[Backfill] Fatal error:', err)
  process.exit(1)
})
