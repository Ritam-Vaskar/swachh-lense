const REPORT_CATEGORIES = [
  'Overflowing bin',
  'Illegal dumpsite',
  'Blocked drain',
  'Street litter',
  'Medical waste',
  'Construction debris',
  'Dead animal',
  'Public toilet issue',
]

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

  let volume = 'Medium'
  for (const [vol, words] of Object.entries(VOLUME_KEYWORDS)) {
    if (words.some((w) => text.includes(w))) {
      volume = vol
      break
    }
  }

  const volumeScore = { Small: 30, Medium: 50, Large: 75, Overflowing: 95 }[volume]
  let severity = volumeScore + (hazard_flag ? 10 : 0)
  severity = Math.min(100, severity)

  const hazardWords = ['syringe', 'medical', 'blood', 'chemical', 'dead', 'flood', 'overflow', 'hazard']
  const detectedHazard = hazard_flag || hazardWords.some((w) => text.includes(w))

  const confidence = 82 + Math.floor(Math.random() * 16)
  const team_size = volume === 'Overflowing' ? 4 : volume === 'Large' ? 3 : volume === 'Medium' ? 2 : 1

  let priority = 'Low'
  if (severity >= 85) priority = 'Critical'
  else if (severity >= 65) priority = 'High'
  else if (severity >= 40) priority = 'Medium'

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
