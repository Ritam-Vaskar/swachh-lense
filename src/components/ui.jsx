import * as Icons from 'lucide-react'

export function Icon({ name, size = 18, ...props }) {
  const Cmp = Icons[name] || Icons.Circle
  return <Cmp size={size} {...props} />
}

export function Badge({ color, children }) {
  return (
    <span className="badge" style={{ background: `${color}1a`, color }}>
      <span className="badge-dot" style={{ background: color }} />
      {children}
    </span>
  )
}

export function Tag({ tone = 'default', children }) {
  if (tone === 'hazard') return <span className="tag tag-hazard">{children}</span>
  return <span className="tag">{children}</span>
}

export function Toast({ toast }) {
  return (
    <div className={`toast ${toast.type || ''}`}>
      <Icon name={toast.type === 'success' ? 'CheckCircle2' : toast.type === 'error' ? 'AlertCircle' : 'Info'} size={18} />
      <span>{toast.message}</span>
    </div>
  )
}
