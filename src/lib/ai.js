import { REPORT_CATEGORIES } from './supabaseClient'

// Mocked AI triage. Structured so a real model (edge function + vision API) can drop in later
// by replacing analyzeReport with a fetch to an edge function.

const CATEGORY_KEYWORDS = {
  'Overflowing bin': ['bin', 'garbage', 'overflow', 'dustbin', 'trash can'],
  'Illegal dumpsite': ['dump', 'debris', 'construction', 'rubble', 'dumped'],
  'Blocked drain': ['drain', 'sewage', 'water', 'clogged', 'flood'],
  'Street litter': ['litter', 'wrapper', 'plastic', 'cups', 'street'],
  'Medical waste': ['syringe', 'medical', 'hospital', 'gloves', 'mask'],
  'Construction debris': ['debris', 'bricks', 'cement', 'construction'],
  'Dead animal': ['dead', 'animal', 'carcass', 'dog', 'cat'],
  'Public toilet issue': ['toilet', 'urinal', 'bathroom', 'latrine'],
}

const VOLUME_KEYWORDS = {
  Overflowing: ['overflow', 'spilling', 'huge', 'massive', 'pile'],
  Large: ['large', 'big', 'lot', 'many', 'heavy'],
  Medium: ['medium', 'some', 'few bags'],
  Small: ['small', 'little', 'few', 'minor'],
}

export function analyzeReport({ description = '', category = '', hazard_flag = false }) {
  const text = `${category} ${description}`.toLowerCase()

  // Detect category from keywords if not explicitly provided
  let detectedCategory = category
  if (!detectedCategory) {
    for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
      if (words.some((w) => text.includes(w))) {
        detectedCategory = cat
        break
      }
    }
    detectedCategory = detectedCategory || REPORT_CATEGORIES[0]
  }

  // Estimate volume
  let volume = 'Medium'
  for (const [vol, words] of Object.entries(VOLUME_KEYWORDS)) {
    if (words.some((w) => text.includes(w))) {
      volume = vol
      break
    }
  }

  // Severity from volume + hazard
  const volumeScore = { Small: 30, Medium: 50, Large: 75, Overflowing: 95 }[volume]
  let severity = volumeScore + (hazard_flag ? 10 : 0)
  severity = Math.min(100, severity)

  // Hazard detection
  const hazardWords = ['syringe', 'medical', 'blood', 'chemical', 'dead', 'flood', 'overflow', 'hazard']
  const detectedHazard = hazard_flag || hazardWords.some((w) => text.includes(w))

  // Confidence (mock — would be model confidence in production)
  const confidence = 82 + Math.floor(Math.random() * 16)

  // Team size from volume
  const team_size = volume === 'Overflowing' ? 4 : volume === 'Large' ? 3 : volume === 'Medium' ? 2 : 1

  // Priority
  let priority = 'Low'
  if (severity >= 85) priority = 'Critical'
  else if (severity >= 65) priority = 'High'
  else if (severity >= 40) priority = 'Medium'

  // Auto-approve threshold: high-severity hazards auto-approve to speed response
  const autoApproved = severity >= 85 && detectedHazard

  return {
    category: detectedCategory,
    volume,
    severity_score: severity,
    priority,
    confidence,
    team_size,
    hazard: detectedHazard,
    autoApproved,
    summary: `${detectedCategory} — ${volume.toLowerCase()} volume detected. ${detectedHazard ? 'Health/safety hazard flagged. ' : ''}Recommended team of ${team_size}. Priority ${priority}.`,
  }
}

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
