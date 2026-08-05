export const categoryIcons = {
  'Overflowing bin': 'Bin',
  'Illegal dumpsite': 'Trash2',
  'Blocked drain': 'Waves',
  'Street litter': 'Leaf',
  'Medical waste': 'Cross',
  'Construction debris': 'HardHat',
  'Dead animal': 'PawPrint',
  'Public toilet issue': 'Bath',
}

export const categoryColors = {
  'Overflowing bin': '#0ea5e9',
  'Illegal dumpsite': '#ef4444',
  'Blocked drain': '#06b6d4',
  'Street litter': '#84cc16',
  'Medical waste': '#ec4899',
  'Construction debris': '#f59e0b',
  'Dead animal': '#64748b',
  'Public toilet issue': '#8b5cf6',
}

export const statusColors = {
  New: '#6366f1',
  Verified: '#0ea5e9',
  Assigned: '#f59e0b',
  'In Progress': '#a855f7',
  Resolved: '#16a34a',
  Closed: '#64748b',
}

export const priorityColors = {
  Low: '#64748b',
  Medium: '#0ea5e9',
  High: '#f59e0b',
  Critical: '#ef4444',
}

export const taskStatusColors = {
  Assigned: '#f59e0b',
  'En route': '#a855f7',
  'On site': '#0ea5e9',
  Completed: '#16a34a',
  Verified: '#22c55e',
  Cancelled: '#64748b',
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDate(timestamp) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeSince(timestamp) {
  if (!timestamp) return 0
  return Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000)
}

export function getSlaStatus(report) {
  const minutes = timeSince(report.reported_at)
  const threshold =
    report.priority === 'Critical' ? 240 : report.priority === 'High' ? 480 : report.priority === 'Medium' ? 1440 : 2880
  const percent = Math.min(100, (minutes / threshold) * 100)
  if (report.status === 'Resolved' || report.status === 'Closed') {
    return { label: 'Met', color: '#16a34a', percent: 100 }
  }
  if (percent >= 100) return { label: 'Breached', color: '#ef4444', percent: 100 }
  if (percent >= 75) return { label: 'At risk', color: '#f59e0b', percent }
  return { label: 'On track', color: '#16a34a', percent }
}
