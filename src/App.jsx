import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { api } from './lib/api/index.js'
import { seedDemoData } from './lib/seed'
import { Badge, Icon, Tag, Toast } from './components/ui'
import NewReportModal from './components/NewReportModal'
import ReportDrawer from './components/ReportDrawer'
import AuthScreen from './components/AuthScreen'
import CitizenPortal from './components/CitizenPortal'
import WorkerDashboard from './components/WorkerDashboard'
import MapView from './components/MapView'
import {
  statusColors,
  priorityColors,
  categoryColors,
  categoryIcons,
  formatRelativeTime,
  getSlaStatus,
} from './lib/constants'
import './App.css'

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'map', label: 'Live map', icon: 'Map' },
  { id: 'approvals', label: 'Approvals', icon: 'ClipboardCheck' },
  { id: 'intake', label: 'Intake queue', icon: 'Inbox' },
  { id: 'dispatch', label: 'Dispatch', icon: 'Truck' },
  { id: 'verify', label: 'Verification', icon: 'ShieldCheck' },
  { id: 'analytics', label: 'Analytics', icon: 'BarChart3' },
]

function AppInner() {
  const { session, profile, loading } = useAuth()
  const [route, setRoute] = useState('app')

  if (loading) {
    return <div className="spinner-wrap" style={{ height: '100vh' }}><div className="spinner" /></div>
  }

  if (route === 'citizen') {
    return <CitizenPortal onBackToSignIn={() => setRoute('app')} />
  }

  if (!session || !profile) {
    return <AuthScreen onCitizen={() => setRoute('citizen')} />
  }

  if (profile.role === 'worker') {
    return <WorkerDashboard onSignOut={() => {}} />
  }

  return <OperatorDashboard />
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}

function OperatorDashboard() {
  const { profile, signOut } = useAuth()
  const [reports, setReports] = useState([])
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('dashboard')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [approvalFilter, setApprovalFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [toasts, setToasts] = useState([])
  const [seeding, setSeeding] = useState(false)

  const toast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const loadReports = useCallback(async () => {
    setLoading(true)
    const { data, error } = await api.from('swachhlens_reports').select('*').order('reported_at', { ascending: false })
    if (error) toast('Could not load reports.', 'error')
    else setReports(data || [])
    setLoading(false)
  }, [toast])

  const loadWorkers = useCallback(async () => {
    const { data } = await api.from('profiles').select('*').eq('role', 'worker')
    setWorkers(data || [])
  }, [])

  useEffect(() => {
    ;(async () => {
      setSeeding(true)
      try {
        const didSeed = await seedDemoData()
        if (didSeed) toast('Demo reports loaded.', 'success')
      } catch { /* ignore */ }
      setSeeding(false)
      await loadReports()
      await loadWorkers()
    })()

    // Realtime subscriptions
    const reportSub = api
      .channel('reports-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'swachhlens_reports' }, (payload) => {
        if (payload.eventType === 'INSERT' && payload.new?.id) {
          setReports((r) => [payload.new, ...r])
          toast('New report received from citizen.', 'success')
        } else if (payload.eventType === 'UPDATE' && payload.new?.id) {
          setReports((r) => r.map((x) => (x.id === payload.new.id ? { ...x, ...payload.new } : x)))
        } else if (payload.eventType === 'DELETE' && payload.old?.id) {
          setReports((r) => r.filter((x) => x.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => api.removeChannel(reportSub)
  }, [loadReports, loadWorkers, toast])

  function handleChanged(updated) {
    setReports((list) => list.map((r) => (r.id === updated.id ? updated : r)))
    setSelected(updated)
  }

  function handleCreated(created) {
    setReports((list) => [created, ...list])
    setShowNew(false)
    setSelected(created)
    toast('Report created.', 'success')
  }

  const filtered = useMemo(() => {
    let list = reports
    if (view === 'intake') list = list.filter((r) => r.status === 'New' || r.status === 'Verified')
    if (view === 'dispatch') list = list.filter((r) => r.status === 'Assigned' || r.status === 'In Progress')
    if (view === 'verify') list = list.filter((r) => r.status === 'Resolved' || r.status === 'Closed')
    if (view === 'approvals') list = list.filter((r) => r.approval_status === 'Pending')
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter)
    if (priorityFilter !== 'all') list = list.filter((r) => r.priority === priorityFilter)
    if (zoneFilter !== 'all') list = list.filter((r) => r.zone === zoneFilter)
    if (approvalFilter !== 'all') list = list.filter((r) => r.approval_status === approvalFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (r) =>
          r.reference_code.toLowerCase().includes(q) ||
          r.location.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.zone.toLowerCase().includes(q),
      )
    }
    return list
  }, [reports, view, statusFilter, priorityFilter, zoneFilter, approvalFilter, search])

  const kpis = useMemo(() => {
    const total = reports.length
    const active = reports.filter((r) => r.status !== 'Closed' && r.status !== 'Resolved').length
    const resolved = reports.filter((r) => r.status === 'Resolved' || r.status === 'Closed').length
    const critical = reports.filter((r) => r.priority === 'Critical' && r.status !== 'Closed').length
    const breached = reports.filter((r) => getSlaStatus(r).label === 'Breached').length
    const pending = reports.filter((r) => r.approval_status === 'Pending').length
    const resolutionRate = total ? Math.round((resolved / total) * 100) : 0
    return { total, active, resolved, critical, breached, pending, resolutionRate }
  }, [reports])

  const counts = useMemo(
    () => ({
      dashboard: reports.length,
      map: reports.filter((r) => r.latitude != null).length,
      approvals: reports.filter((r) => r.approval_status === 'Pending').length,
      intake: reports.filter((r) => r.status === 'New' || r.status === 'Verified').length,
      dispatch: reports.filter((r) => r.status === 'Assigned' || r.status === 'In Progress').length,
      verify: reports.filter((r) => r.status === 'Resolved').length,
      analytics: 0,
    }),
    [reports],
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Icon name="Leaf" size={20} /></div>
          <div>SwachhLens<div className="brand-sub">Operations · {profile?.full_name}</div></div>
        </div>
        <div className="topbar-actions">
          <span className="live-pill"><span className="live-dot" /> Live</span>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}><Icon name="Plus" size={16} /> New report</button>
          <button className="btn btn-ghost btn-sm" onClick={() => signOut()}><Icon name="LogOut" size={14} /> Sign out</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-section">Operations</div>
          {NAV.map((item) => (
            <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}>
              <Icon name={item.icon} size={18} />
              {item.label}
              {counts[item.id] > 0 && <span className="nav-badge">{counts[item.id]}</span>}
            </button>
          ))}
          <div className="sidebar-section">Crew</div>
          <div className="crew-list">
            {workers.map((w) => (
              <div key={w.id} className="crew-item">
                <span className={`crew-dot ${w.is_available ? 'available' : 'busy'}`} />
                <span className="crew-name">{w.full_name}</span>
                <span className="muted" style={{ fontSize: 11 }}>{w.zone}</span>
              </div>
            ))}
            {workers.length === 0 && <p className="muted" style={{ fontSize: 12, padding: '0 14px' }}>No workers registered yet.</p>}
          </div>
        </aside>

        <main className="main">
          {view === 'map' ? (
            <MapDashboard reports={reports} workers={workers} onSelect={setSelected} selectedId={selected?.id} />
          ) : view === 'analytics' ? (
            <AnalyticsView reports={reports} />
          ) : (
            <>
              <div className="kpi-grid">
                <KpiCard icon="Inbox" label="Total reports" value={kpis.total} trend={`${kpis.active} active`} />
                <KpiCard icon="ClipboardCheck" label="Pending approval" value={kpis.pending} tone="warning" trend="awaiting review" />
                <KpiCard icon="AlertTriangle" label="Critical" value={kpis.critical} tone="danger" trend="needs attention" />
                <KpiCard icon="CheckCircle2" label="Resolved" value={kpis.resolved} tone="success" trend={`${kpis.resolutionRate}% rate`} />
                <KpiCard icon="Clock" label="SLA breaches" value={kpis.breached} tone="danger" trend="overdue" />
              </div>

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <h3 className="panel-title">{NAV.find((n) => n.id === view).label}</h3>
                    <div className="panel-sub">{filtered.length} report{filtered.length === 1 ? '' : 's'}</div>
                  </div>
                </div>
                <div className="panel-body" style={{ paddingBottom: 0 }}>
                  <div className="filters">
                    <div className="search-box">
                      <span className="search-icon"><Icon name="Search" size={16} /></span>
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by reference, location, category, zone…" />
                    </div>
                    <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                      <option value="all">All statuses</option>
                      {['New', 'Verified', 'Assigned', 'In Progress', 'Resolved', 'Closed'].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select className="select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
                      <option value="all">All priorities</option>
                      {['Low', 'Medium', 'High', 'Critical'].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select className="select" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                      <option value="all">All zones</option>
                      {['Central', 'North', 'South', 'East', 'West', 'Riverside', 'Industrial'].map((z) => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </div>
                </div>

                <div className="table-wrap">
                  {loading || seeding ? (
                    <div className="spinner-wrap"><div className="spinner" /></div>
                  ) : filtered.length === 0 ? (
                    <div className="empty">
                      <Icon name="Inbox" size={36} />
                      <h3>No reports match your filters</h3>
                      <p>Try clearing filters or create a new report.</p>
                    </div>
                  ) : (
                    <table className="reports">
                      <thead>
                        <tr>
                          <th>Reference</th>
                          <th>Category</th>
                          <th>Location</th>
                          <th>Status</th>
                          <th>Approval</th>
                          <th>Priority</th>
                          <th>Dup</th>
                          <th>SLA</th>
                          <th>Reported</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((r) => {
                          const sla = getSlaStatus(r)
                          return (
                            <tr key={r.id} className="clickable" onClick={() => setSelected(r)}>
                              <td><span className="ref-code">{r.reference_code}</span></td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ width: 24, height: 24, borderRadius: 6, background: `${categoryColors[r.category]}1a`, color: categoryColors[r.category], display: 'grid', placeItems: 'center' }}>
                                    <Icon name={categoryIcons[r.category] || 'Trash2'} size={14} />
                                  </span>
                                  {r.category}
                                  {r.hazard_flag && <Tag tone="hazard"><Icon name="AlertTriangle" size={11} /> Hazard</Tag>}
                                </div>
                              </td>
                              <td className="cell-location">{r.location}<small>{r.zone} zone</small></td>
                              <td><Badge color={statusColors[r.status]}>{r.status}</Badge></td>
                              <td>
                                {r.approval_status === 'Pending' && <span className="tag tag-hazard">Pending</span>}
                                {r.approval_status === 'Auto-approved' && <span className="tag" style={{ background: 'var(--success-soft)', color: 'var(--accent)' }}>Auto</span>}
                                {r.approval_status === 'Approved' && <span className="tag" style={{ background: 'var(--success-soft)', color: 'var(--accent)' }}>Approved</span>}
                                {r.approval_status === 'Rejected' && <span className="tag" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>Rejected</span>}
                              </td>
                              <td><Badge color={priorityColors[r.priority]}>{r.priority}</Badge></td>
                              <td>{r.duplicate_count > 1 ? <span className="dup-chip"><Icon name="Copy" size={12} /> {r.duplicate_count}</span> : <span className="muted">—</span>}</td>
                              <td className="sla-cell">
                                <span className="sla-label" style={{ color: sla.color }}>{sla.label}</span>
                                <div className="sla-bar"><div className="sla-fill" style={{ width: `${sla.percent}%`, background: sla.color }} /></div>
                              </td>
                              <td className="muted">{formatRelativeTime(r.reported_at)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <NewReportModal open={showNew} onClose={() => setShowNew(false)} onCreated={handleCreated} />
      <ReportDrawer report={selected} onClose={() => setSelected(null)} onChanged={handleChanged} toast={toast} />

      <div className="toast-container">
        {toasts.map((t) => <Toast key={t.id} toast={t} />)}
      </div>
    </div>
  )
}

function MapDashboard({ reports, workers, onSelect, selectedId }) {
  const geoReports = reports.filter((r) => r.latitude != null)
  const [mapView, setMapView] = useState('all')
  const shown = mapView === 'pending' ? geoReports.filter((r) => r.approval_status === 'Pending') : geoReports

  return (
    <>
      <div className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Live operations map</h3>
            <div className="panel-sub">{shown.length} geolocated reports · {workers.filter((w) => w.latitude).length} workers on map</div>
          </div>
          <div className="row-gap">
            <button className={`btn btn-sm ${mapView === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMapView('all')}>All reports</button>
            <button className={`btn btn-sm ${mapView === 'pending' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMapView('pending')}>Pending only</button>
          </div>
        </div>
        <div className="panel-body">
          <MapView reports={shown} workers={workers} center={[12.9716, 77.5946]} zoom={12} height={520} showWorkers onMarkerClick={onSelect} selectedId={selectedId} />
        </div>
      </div>
      <div className="panel">
        <div className="panel-header"><h3 className="panel-title">Nearby reports</h3></div>
        <div className="panel-body">
          {shown.length === 0 ? <p className="muted">No geolocated reports to display.</p> : (
            <div className="map-report-list">
              {shown.slice(0, 8).map((r) => (
                <div key={r.id} className="map-report-item" onClick={() => onSelect(r)}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: `${categoryColors[r.category]}1a`, color: categoryColors[r.category], display: 'grid', placeItems: 'center' }}>
                    <Icon name={categoryIcons[r.category] || 'Trash2'} size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.category}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{r.location}</div>
                  </div>
                  <Badge color={statusColors[r.status]}>{r.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function KpiCard({ icon, label, value, trend, tone = 'primary' }) {
  const colors = { primary: '#0ea5e9', success: '#16a34a', warning: '#f59e0b', danger: '#ef4444' }
  const color = colors[tone]
  return (
    <div className="kpi-card">
      <div className="kpi-icon" style={{ background: `${color}1a`, color }}><Icon name={icon} size={18} /></div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-trend">{trend}</div>
    </div>
  )
}

function AnalyticsView({ reports }) {
  const byCategory = useMemo(() => {
    const map = {}
    reports.forEach((r) => { map[r.category] = (map[r.category] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [reports])
  const byZone = useMemo(() => {
    const map = {}
    reports.forEach((r) => { map[r.zone] = (map[r.zone] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [reports])
  const byStatus = useMemo(() => {
    const map = {}
    reports.forEach((r) => { map[r.status] = (map[r.status] || 0) + 1 })
    return map
  }, [reports])
  const maxCat = Math.max(1, ...byCategory.map((c) => c[1]))
  const maxZone = Math.max(1, ...byZone.map((c) => c[1]))

  return (
    <>
      <div className="kpi-grid">
        <KpiCard icon="BarChart3" label="Categories" value={byCategory.length} trend="waste types" />
        <KpiCard icon="MapPin" label="Zones active" value={byZone.length} trend="across city" />
        <KpiCard icon="TrendingUp" label="Avg confidence" value={reports.length ? Math.round(reports.reduce((s, r) => s + r.confidence, 0) / reports.length) : 0} trend="AI triage" />
        <KpiCard icon="Copy" label="Duplicate clusters" value={reports.filter((r) => r.duplicate_count > 1).length} trend="merged" />
        <KpiCard icon="ShieldCheck" label="Verified" value={byStatus['Closed'] || 0} trend="audit ready" />
      </div>
      <div className="panel">
        <div className="panel-header"><h3 className="panel-title">Reports by category</h3></div>
        <div className="panel-body">
          {byCategory.length === 0 ? <p className="muted">No data yet.</p> : byCategory.map(([cat, count]) => (
            <div key={cat} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 14 }}><span>{cat}</span><span className="muted">{count}</span></div>
              <div className="sla-bar" style={{ height: 8 }}><div className="sla-fill" style={{ width: `${(count / maxCat) * 100}%`, background: categoryColors[cat] || 'var(--primary)' }} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-header"><h3 className="panel-title">Reports by zone</h3></div>
        <div className="panel-body">
          {byZone.length === 0 ? <p className="muted">No data yet.</p> : byZone.map(([zone, count]) => (
            <div key={zone} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 14 }}><span>{zone}</span><span className="muted">{count}</span></div>
              <div className="sla-bar" style={{ height: 8 }}><div className="sla-fill" style={{ width: `${(count / maxZone) * 100}%`, background: 'var(--primary)' }} /></div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
