import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api/index.js'
import { useAuth } from '../lib/auth'
import { rateCompletion } from '../lib/ai'
import { uploadEvidence } from '../lib/storage'
import { Icon, Toast } from './ui'
import MapView from './MapView'
import { statusColors, priorityColors, formatRelativeTime, formatDate, getSlaStatus } from '../lib/constants'

export default function WorkerDashboard({ onSignOut }) {
  const { profile, signOut } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState(null)
  const [view, setView] = useState('list')

  function showToast(message, type = 'info') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const loadTasks = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const { data } = await api
      .from('swachhlens_tasks')
      .select('*, report:swachhlens_reports(*)')
      .eq('worker_id', profile.id)
      .order('created_at', { ascending: false })
    setTasks(data || [])
    setLoading(false)
  }, [profile])

  useEffect(() => {
    loadTasks()
    // Realtime subscription for new task assignments
    const sub = api
      .channel('worker-tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'swachhlens_tasks', filter: `worker_id=eq.${profile?.id}` }, () => loadTasks())
      .subscribe()
    return () => api.removeChannel(sub)
  }, [loadTasks, profile])

  // Update worker's live GPS
  useEffect(() => {
    if (!profile) return
    if (navigator.geolocation) {
      const watcher = navigator.geolocation.watchPosition(
        (pos) => {
          api
            .from('profiles')
            .update({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
            .eq('id', profile.id)
            .then(() => {})
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 30000 },
      )
      return () => navigator.geolocation.clearWatch(watcher)
    }
  }, [profile])

  async function updateTaskStatus(task, status) {
    const { error } = await api
      .from('swachhlens_tasks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', task.id)
    if (error) { showToast('Could not update status.', 'error'); return }
    setTasks((t) => t.map((x) => (x.id === task.id ? { ...x, status } : x)))
    setSelected({ ...selected, ...task, status })
    showToast(`Task marked ${status}.`, 'success')
  }

  async function submitCompletion(task, { afterPhoto, afterNote }) {
    let afterUrl = null
    if (afterPhoto) {
      const { url } = await uploadEvidence(afterPhoto, 'worker-after')
      afterUrl = url
    }
    const rating = rateCompletion({
      beforeDescription: task.report?.description,
      afterDescription: afterNote,
      beforeUrl: task.report?.image_url,
      afterUrl,
    })
    const { error } = await api
      .from('swachhlens_tasks')
      .update({
        status: 'Completed',
        after_image_url: afterUrl,
        worker_note: afterNote,
        ai_rating: rating,
        completion_score: rating,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id)
    if (error) { showToast('Could not submit completion.', 'error'); return }

    // Update the linked report to Resolved
    await api
      .from('swachhlens_reports')
      .update({ status: 'Resolved', citizen_update: 'Site cleaned. Awaiting verification.', updated_at: new Date().toISOString() })
      .eq('id', task.report_id)

    setTasks((t) => t.map((x) => (x.id === task.id ? { ...x, status: 'Completed', after_image_url: afterUrl, ai_rating: rating, worker_note: afterNote } : x)))
    setSelected(null)
    showToast(`Cleanup submitted. AI rating: ${rating}/100`, 'success')
  }

  const active = tasks.filter((t) => t.status !== 'Completed' && t.status !== 'Verified' && t.status !== 'Cancelled')
  const completed = tasks.filter((t) => t.status === 'Completed' || t.status === 'Verified')

  return (
    <div className="worker-app">
      <header className="worker-header">
        <div className="brand">
          <div className="brand-mark"><Icon name="HardHat" size={20} /></div>
          <div>SwachhLens <span className="brand-sub">Worker</span></div>
        </div>
        <div className="worker-header-info">
          <span className="worker-name"><Icon name="User" size={15} /> {profile?.full_name}</span>
          <span className="tag">{profile?.zone} zone</span>
          <span className={`live-pill ${profile?.is_available ? '' : 'busy'}`}>
            <span className="live-dot" style={{ background: profile?.is_available ? '#16a34a' : '#94a3b8' }} />
            {profile?.is_available ? 'Available' : 'Busy'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => signOut().then(onSignOut)}><Icon name="LogOut" size={14} /> Sign out</button>
        </div>
      </header>

      <main className="worker-main">
        <div className="worker-tabs">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            <Icon name="List" size={16} /> My tasks {active.length > 0 && <span className="nav-badge">{active.length}</span>}
          </button>
          <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
            <Icon name="Map" size={16} /> Map
          </button>
        </div>

        {view === 'map' && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-header"><h3 className="panel-title">Task map</h3></div>
            <div className="panel-body">
              <MapView
                reports={tasks.map((t) => ({ ...t.report, id: t.report?.id || t.id, latitude: t.latitude || t.report?.latitude, longitude: t.longitude || t.report?.longitude, status: t.status, priority: t.report?.priority, approval_status: 'Approved', reference_code: t.task_code })).filter((r) => r.latitude != null)}
                workers={[profile]}
                center={[profile?.latitude || 12.9716, profile?.longitude || 77.5946]}
                zoom={13}
                height={440}
                showWorkers
                onMarkerClick={(r) => {
                  const task = tasks.find((t) => t.id === r.id)
                  if (task) setSelected(task)
                }}
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <>
            <h3 className="section-h">Active tasks ({active.length})</h3>
            {active.length === 0 ? (
              <div className="empty">
                <Icon name="Coffee" size={36} />
                <h3>No active tasks</h3>
                <p>New assignments will appear here in real time.</p>
              </div>
            ) : (
              <div className="task-cards">
                {active.map((t) => (
                  <TaskCard key={t.id} task={t} onClick={() => setSelected(t)} onStatus={(s) => updateTaskStatus(t, s)} />
                ))}
              </div>
            )}

            <h3 className="section-h" style={{ marginTop: 28 }}>Completed ({completed.length})</h3>
            {completed.length === 0 ? (
              <p className="muted">No completed tasks yet.</p>
            ) : (
              <div className="task-cards">
                {completed.map((t) => (
                  <TaskCard key={t.id} task={t} completed onClick={() => setSelected(t)} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {selected && (
        <TaskDrawer
          task={selected}
          onClose={() => setSelected(null)}
          onStatus={(s) => updateTaskStatus(selected, s)}
          onSubmit={submitCompletion}
          toast={showToast}
        />
      )}

      {toast && <div className="toast-container"><Toast toast={toast} /></div>}
    </div>
  )
}

function TaskCard({ task, onClick, onStatus, completed }) {
  const report = task.report
  const sla = report ? getSlaStatus(report) : null
  return (
    <div className={`task-card ${completed ? 'completed' : ''}`} onClick={onClick}>
      <div className="task-card-top">
        <span className="ref-code">{task.task_code}</span>
        <span className="badge" style={{ background: `${statusColors[task.status]}1a`, color: statusColors[task.status] }}>
          <span className="badge-dot" style={{ background: statusColors[task.status] }} /> {task.status}
        </span>
      </div>
      {report && (
        <>
          <div className="task-card-title">{report.category}</div>
          <div className="muted task-card-loc"><Icon name="MapPin" size={13} /> {report.location}</div>
          <div className="task-card-meta">
            <span className="badge" style={{ background: `${priorityColors[report.priority]}1a`, color: priorityColors[report.priority] }}>{report.priority}</span>
            <span>Team of {report.team_size}</span>
            <span>ETA {task.eta}</span>
            {task.ai_rating && <span className="badge" style={{ background: 'var(--success-soft)', color: 'var(--accent)' }}>Rating {task.ai_rating}</span>}
          </div>
          {sla && !completed && (
            <div className="sla-cell" style={{ marginTop: 8 }}>
              <div className="sla-bar"><div className="sla-fill" style={{ width: `${sla.percent}%`, background: sla.color }} /></div>
            </div>
          )}
        </>
      )}
      {!completed && task.status === 'Assigned' && (
        <button className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }} onClick={(e) => { e.stopPropagation(); onStatus('En route') }}>
          <Icon name="Navigation" size={14} /> Start navigation
        </button>
      )}
    </div>
  )
}

function TaskDrawer({ task, onClose, onStatus, onSubmit, toast }) {
  const [afterPhoto, setAfterPhoto] = useState(null)
  const [afterUrl, setAfterUrl] = useState(null)
  const [afterNote, setAfterNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const report = task.report

  function handlePhoto(file) {
    setAfterPhoto(file)
    setAfterUrl(URL.createObjectURL(file))
  }

  async function submit() {
    if (!afterPhoto && !afterNote) {
      toast('Add an after photo or note to submit.', 'error')
      return
    }
    setSubmitting(true)
    await onSubmit(task, { afterPhoto, afterNote })
    setSubmitting(false)
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span className="ref-code">{task.task_code}</span>
              <span className="badge" style={{ background: `${statusColors[task.status]}1a`, color: statusColors[task.status] }}>
                <span className="badge-dot" style={{ background: statusColors[task.status] }} /> {task.status}
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{report?.category}</h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{report?.location}</p>
          </div>
          <button className="drawer-close" onClick={onClose}><Icon name="X" size={20} /></button>
        </div>

        <div className="drawer-body">
          <div className="detail-section">
            <div className="detail-label">Task details</div>
            <div className="detail-grid">
              <div className="detail-field"><strong>Crew</strong><span>{task.crew_name}</span></div>
              <div className="detail-field"><strong>Vehicle</strong><span>{task.vehicle}</span></div>
              <div className="detail-field"><strong>ETA</strong><span>{task.eta}</span></div>
              <div className="detail-field"><strong>Scheduled</strong><span>{formatDate(task.scheduled_for)}</span></div>
              <div className="detail-field"><strong>Team size</strong><span>{report?.team_size} worker{report?.team_size > 1 ? 's' : ''}</span></div>
              <div className="detail-field"><strong>Priority</strong><span>{report?.priority}</span></div>
            </div>
            {report?.description && <p style={{ fontSize: 14, marginTop: 12, lineHeight: 1.6 }}>{report.description}</p>}
          </div>

          {report?.image_url && (
            <div className="detail-section">
              <div className="detail-label">Before photo (from citizen)</div>
              <div className="image-placeholder"><img src={report.image_url} alt="Before" /></div>
            </div>
          )}

          {report?.latitude && (
            <div className="detail-section">
              <div className="detail-label">Site location</div>
              <MapView reports={[{ ...report, approval_status: 'Approved' }]} center={[report.latitude, report.longitude]} zoom={16} height={220} />
            </div>
          )}

          {task.status !== 'Completed' && task.status !== 'Verified' && (
            <div className="detail-section">
              <div className="detail-label">Submit cleanup evidence</div>
              <div className="form-group">
                <label>After photo</label>
                {afterUrl ? (
                  <div className="image-placeholder"><img src={afterUrl} alt="After" /></div>
                ) : (
                  <label className="capture-zone small">
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files[0] && handlePhoto(e.target.files[0])} hidden />
                    <Icon name="Camera" size={28} />
                    <span>Take after photo</span>
                  </label>
                )}
              </div>
              <div className="form-group">
                <label>Completion note</label>
                <textarea value={afterNote} onChange={(e) => setAfterNote(e.target.value)} placeholder="e.g. Bin cleared, area washed and disinfected" />
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                <Icon name="Sparkles" size={12} /> AI will compare before &amp; after photos to generate a quality rating.
              </p>
            </div>
          )}

          {task.ai_rating != null && (
            <div className="detail-section">
              <div className="detail-label">AI completion rating</div>
              <div className="rating-display">
                <div className="rating-score" style={{ color: task.ai_rating >= 80 ? '#16a34a' : task.ai_rating >= 60 ? '#f59e0b' : '#ef4444' }}>
                  {task.ai_rating}<span>/100</span>
                </div>
                <div className="rating-bar"><div className="rating-fill" style={{ width: `${task.ai_rating}%`, background: task.ai_rating >= 80 ? '#16a34a' : task.ai_rating >= 60 ? '#f59e0b' : '#ef4444' }} /></div>
              </div>
              {task.worker_note && <p style={{ fontSize: 13, marginTop: 8 }} className="muted">{task.worker_note}</p>}
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {task.status === 'Assigned' && <button className="btn btn-primary" onClick={() => onStatus('En route')}><Icon name="Navigation" size={16} /> En route</button>}
          {task.status === 'En route' && <button className="btn btn-primary" onClick={() => onStatus('On site')}><Icon name="MapPin" size={16} /> On site</button>}
          {task.status === 'On site' && (
            <button className="btn btn-success" onClick={submit} disabled={submitting}>
              <Icon name="Check" size={16} /> {submitting ? 'Submitting…' : 'Submit cleanup'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
