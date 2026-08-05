export const REPORT_CATEGORIES = [
	'Overflowing bin',
	'Illegal dumpsite',
	'Blocked drain',
	'Street litter',
	'Medical waste',
	'Construction debris',
	'Dead animal',
	'Public toilet issue',
]

export const ZONES = ['Central', 'North', 'South', 'East', 'West', 'Riverside', 'Industrial']

export const STATUS_FLOW = ['New', 'Verified', 'Assigned', 'In Progress', 'Resolved', 'Closed']
export const PRIORITY_LEVELS = ['Low', 'Medium', 'High', 'Critical']
export const VOLUME_LEVELS = ['Small', 'Medium', 'Large', 'Overflowing']
export const TASK_STATUS_FLOW = ['Assigned', 'En route', 'On site', 'Completed', 'Verified', 'Cancelled']

export const SEVERITY_BY_VOLUME = { Small: 30, Medium: 50, Large: 75, Overflowing: 95 }
export const PRIORITY_BY_SEVERITY = (score) => {
	if (score >= 85) return 'Critical'
	if (score >= 65) return 'High'
	if (score >= 40) return 'Medium'
	return 'Low'
}

export function generateReferenceCode() {
	const stamp = Date.now().toString(36).toUpperCase().slice(-5)
	const rand = Math.random().toString(36).toUpperCase().slice(2, 5)
	return `SL-${stamp}${rand}`
}

export function generateTaskCode() {
	const stamp = Date.now().toString(36).toUpperCase().slice(-5)
	const rand = Math.random().toString(36).toUpperCase().slice(2, 4)
	return `TASK-${stamp}${rand}`
}
