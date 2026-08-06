import { REPORT_CATEGORIES } from './api/index.js'

// Removed analyzeReport — all AI analysis now runs securely on the backend.

// Mocked before/after comparison rating. Returns 0-100.
// A real implementation would call a vision model comparing the two images.
export function rateCompletion({ afterDescription = '', afterUrl }) {
  // Base score for submitting after photo
  let score = 70
  const after = afterDescription.toLowerCase()
  if (after.includes('clean') || after.includes('cleared') || after.includes('washed')) score += 15
  if (after.includes('disinfected') || after.includes('sanitized')) score += 8
  if (afterUrl) score += 7
  // Deduct if after still mentions waste
  if (after.includes('waste') || after.includes('remaining') || after.includes('partial')) score -= 12
  return Math.max(0, Math.min(100, score))
}

// Nearest worker matching — pure function, takes worker list + report location.
export function findNearestWorker(workers, lat, lng) {
  if (!lat || !lng) return null
  const available = workers.filter((w) => w.is_available && w.role === 'worker')
  if (available.length === 0) return null
  let best = null
  let bestDist = Infinity
  for (const w of available) {
    if (w.latitude == null || w.longitude == null) continue
    const d = Math.sqrt(Math.pow(w.latitude - lat, 2) + Math.pow(w.longitude - lng, 2))
    if (d < bestDist) {
      bestDist = d
      best = w
    }
  }
  return best
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
