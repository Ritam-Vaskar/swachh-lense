import assert from 'node:assert/strict'
import { findNearestWorker, haversineKm } from '../../src/lib/ai.js'

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function scoreWorkers(workers, report) {
  const hasReportGps = report.latitude != null && report.longitude != null

  const scored = workers.map(w => {
    let score = 0
    let distKm = null

    if (hasReportGps && w.latitude != null && w.longitude != null) {
      const distMeters = getDistance(report.latitude, report.longitude, w.latitude, w.longitude)
      distKm = distMeters / 1000
      score = 100000 / (1 + distKm) + (w.zone === report.zone ? 5 : 0)
    } else if (w.zone === report.zone) {
      score = hasReportGps ? 50 : 100
    } else {
      score = 10
    }

    return { worker: w, score, distKm }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored
}

console.log('=== Test 1: Haversine distance calculations ===')
const msdLat = 24.1750, msdLng = 88.2800 // Murshidabad
const reportLat = 24.1755, reportLng = 88.2805 // Report in Murshidabad
const greenLat = 12.9783, greenLng = 77.5921 // Green Squad (Bangalore)
const bbsrLat = 20.3568, bbsrLng = 85.8198 // Bhubaneswar Squad

const distMsd = haversineKm(reportLat, reportLng, msdLat, msdLng)
const distGreen = haversineKm(reportLat, reportLng, greenLat, greenLng)
const distBbsr = haversineKm(reportLat, reportLng, bbsrLat, bbsrLng)

console.log(`Murshidabad worker distance: ${distMsd.toFixed(3)} km`)
console.log(`Green Squad distance: ${distGreen.toFixed(1)} km`)
console.log(`Bhubaneswar Squad distance: ${distBbsr.toFixed(1)} km`)

assert.ok(distMsd < 0.1, 'Murshidabad worker should be under 100 meters away')
assert.ok(distBbsr > 400, 'Bhubaneswar squad should be > 400 km away')
assert.ok(distGreen > 1500, 'Green squad should be > 1500 km away')

console.log('\n=== Test 2: Dispatch Agent scoring & assignment ===')
const workers = [
  { id: '1', full_name: 'Green Squad A', email: 'green@squad.local', zone: 'Central', latitude: greenLat, longitude: greenLng, is_available: true, role: 'worker' },
  { id: '2', full_name: 'Bhubaneswar Squad', email: 'bbsr@squad.local', zone: 'Central', latitude: bbsrLat, longitude: bbsrLng, is_available: true, role: 'worker' },
  { id: '3', full_name: 'Murshidabad Squad', email: 'msd@squad.local', zone: 'East', latitude: msdLat, longitude: msdLng, is_available: true, role: 'worker' },
]

const report = {
  id: 'rep-1',
  category: 'Illegal dumpsite',
  zone: 'Central', // even if report has default 'Central' zone!
  latitude: reportLat,
  longitude: reportLng,
}

const ranking = scoreWorkers(workers, report)
console.log('Worker ranking for Murshidabad report:')
ranking.forEach((r, i) => {
  console.log(`  #${i + 1}: ${r.worker.full_name} (${r.worker.email}) - Score: ${r.score.toFixed(1)}, Dist: ${r.distKm?.toFixed(2)} km`)
})

assert.equal(ranking[0].worker.email, 'msd@squad.local', 'msd@squad.local must be ranked #1')
assert.ok(ranking[0].score > ranking[1].score * 100, 'msd squad score should overwhelmingly exceed distant squads')

console.log('\n=== Test 3: Frontend findNearestWorker in ai.js ===')
const nearestFrontendWorker = findNearestWorker(workers, reportLat, reportLng)
console.log('Nearest worker found by ai.js findNearestWorker:', nearestFrontendWorker.full_name)
assert.equal(nearestFrontendWorker.email, 'msd@squad.local', 'findNearestWorker must return msd@squad.local')

console.log('\n🎉 ALL LOGIC AND UNIT TESTS PASSED SUCCESSFULLY!')
