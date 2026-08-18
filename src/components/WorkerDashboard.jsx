import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api/index.js'
import { useAuth } from '../lib/auth'
import { uploadEvidence } from '../lib/storage'
import { Icon, Toast } from './ui'
import MapView from './MapView'
import WorkerNavigationModal from './WorkerNavigationModal'
import { statusColors, priorityColors, formatDate, getSlaStatus } from '../lib/constants'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function ScoreBar({ score }) {
  const color = score >= 80 ? '#16a34a' : score >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div className="verify-score-bar">
      <div className="verify-score-track">
        <div className="verify-score-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="verify-score-label" style={{ color }}>{score}/100</span>
    </div>
  )
}

// ─── Verification Modal ───────────────────────────────────────────────────────
function VerificationModal({ result, beforeUrl, afterUrl, onRetry, onConfirm, submitting }) {
  const { passed, overall_score = 0, rejection_reasons = [], ai_feedback = '',
    is_same_location, is_cleaned, is_relevant,
    before_scene_description, after_scene_description } = result

  const checks = [
    { label: 'Same location detected', passed: is_same_location },
    { label: 'Waste properly removed', passed: is_cleaned },
    { label: 'Photo is relevant', passed: is_relevant },
  ]

  return (
    <div className="verify-modal-overlay">
      <div className="verify-modal">
        <div className="verify-modal-header">
          <h3><Icon name="Sparkles" size={18} /> AI Verification Report</h3>
        </div>

        {/* Before / After images */}
        <div className="verify-image-pair">
          <div className="verify-image-side">
            <div className="verify-image-label">Before</div>
            {beforeUrl
              ? <img src={beforeUrl} alt="Before" className="verify-img" />
              : <div className="verify-img-placeholder"><Icon name="ImageOff" size={28} /><span>No before photo</span></div>
            }
            {before_scene_description && <p className="verify-scene-desc">{before_scene_description}</p>}
          </div>
          <div className="verify-image-side">
            <div className="verify-image-label">After</div>
            <img src={afterUrl} alt="After" className="verify-img" />
            {after_scene_description && <p className="verify-scene-desc">{after_scene_description}</p>}
          </div>
        </div>

        {/* Checklist */}
        <div className="verify-checklist">
          {checks.map((c) => (
            <div key={c.label} className={`verify-check-item ${c.passed ? 'pass' : 'fail'}`}>
              <Icon name={c.passed ? 'CheckCircle2' : 'XCircle'} size={16} />
              <span>{c.label}</span>
            </div>
          ))}
        </div>

        {/* Score */}
        <div className="verify-score-section">
          <div className="verify-score-title">Completion Score</div>
          <ScoreBar score={overall_score} />
        </div>

        {/* AI Feedback */}
        {ai_feedback && (
          <div className="verify-feedback">
            <Icon name="MessageSquare" size={14} />
            <p>{ai_feedback}</p>
          </div>
        )}

        {/* Result banner */}
        {passed ? (
          <div className="verify-pass-banner">
            <Icon name="CheckCircle2" size={18} />
            <span>Verification passed! Ready to submit to the municipal dashboard.</span>
          </div>
        ) : (
          <div className="verify-fail-banner">
            <Icon name="AlertTriangle" size={18} />
            <div>
              <strong>Your work is not done or the photo is irrelevant.</strong>
              {rejection_reasons.length > 0 && (
                <ul>
                  {rejection_reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="verify-modal-footer">
          {passed
            ? <>
                <button className="btn btn-ghost" onClick={onRetry}>Re-upload photo</button>
                <button className="btn btn-success" onClick={onConfirm} disabled={submitting}>
                  <Icon name="CheckCheck" size={16} />
                  {submitting ? 'Submitting…' : 'Submit to Municipal Dashboard'}
                </button>
              </>
            : <button className="btn btn-primary" onClick={onRetry}>
                <Icon name="RefreshCw" size={16} /> Try Again
              </button>
          }
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function WorkerDashboard({ onSignOut }) {
  const { profile, signOut, updateLocation } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState(null)
  const [view, setView] = useState('list')
  const [navTask, setNavTask] = useState(null)
  const [gpsStatus, setGpsStatus] = useState('detecting')
  const [gpsAccuracy, setGpsAccuracy] = useState(null)

  function showToast(message, type = 'info') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  const profileId = profile?.id
  const hasLocatedRef = useRef(false)

  const loadTasks = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    const { data } = await api
      .from('swachhlens_tasks')
      .select('*, report:swachhlens_reports(*)')
      .eq('worker_id', profileId)
      .order('created_at', { ascending: false })
    setTasks(data || [])
    setLoading(false)
  }, [profileId])

  useEffect(() => {
    if (!profileId) return
    loadTasks()
    const sub = api
      .channel('worker-tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'swachhlens_tasks', filter: `worker_id=eq.${profileId}` }, () => loadTasks())
      .subscribe()
    return () => api.removeChannel(sub)
  }, [loadTasks, profileId])

  // Fetch device GPS location ONCE on login/mount
  const syncGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus('unsupported')
      return
    }
    setGpsStatus('detecting')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        updateLocation(latitude, longitude)
        setGpsAccuracy(Math.round(accuracy))
        setGpsStatus('live')
      },
      (err) => {
        console.warn('[WorkerDashboard] GPS position unavailable:', err?.message || err)
        setGpsStatus('denied')
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  }, [updateLocation])

  useEffect(() => {
    if (!profileId || hasLocatedRef.current) return
    hasLocatedRef.current = true
    syncGps()
  }, [profileId, syncGps])

  async function updateTaskStatus(task, status) {
    const { error } = await api.from('swachhlens_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', task.id)
    if (error) { showToast('Could not update status.', 'error'); return }
    setTasks((t) => t.map((x) => (x.id === task.id ? { ...x, status } : x)))
    setSelected((s) => s ? { ...s, status } : s)
    setNavTask((n) => n && n.id === task.id ? { ...n, status } : n)
    showToast(`Task marked ${status}.`, 'success')
  }

  async function handleStartNavigation(task) {
    // Mark En route first, then open live navigation
    await updateTaskStatus(task, 'En route')
    setNavTask({ ...task, status: 'En route' })
    setSelected(null)
  }

  async function handleArrivedOnSite() {
    if (!navTask) return
    await updateTaskStatus(navTask, 'On site')
    setNavTask(null)
    showToast('Marked On Site. You can now submit cleanup evidence.', 'success')
  }

  function handleTaskCompleted(updatedTask) {
    setTasks((t) => t.map((x) => (x.id === updatedTask.id ? { ...x, ...updatedTask } : x)))
    setSelected(null)
    showToast(`Cleanup verified ✓ Score: ${updatedTask.completion_score}/100`, 'success')
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
          <button
            type="button"
            className={`live-pill ${gpsStatus === 'live' ? '' : 'busy'}`}
            style={{ cursor: 'pointer', border: 'none' }}
            onClick={syncGps}
            title={gpsStatus === 'live' ? `Live GPS Active: ${profile?.latitude?.toFixed(4)}, ${profile?.longitude?.toFixed(4)} (±${gpsAccuracy || 10}m). Click to re-sync.` : 'Click to acquire live GPS'}
          >
            <span className="live-dot" style={{ background: gpsStatus === 'live' ? '#16a34a' : '#f59e0b' }} />
            {gpsStatus === 'live' && profile?.latitude != null
              ? `GPS: ${profile.latitude.toFixed(3)}, ${profile.longitude?.toFixed(3)}`
              : gpsStatus === 'detecting'
              ? 'Locating…'
              : 'GPS Offline'}
          </button>
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
                  <TaskCard key={t.id} task={t} onClick={() => setSelected(t)} onStatus={(s) => updateTaskStatus(t, s)} onNavigate={() => handleStartNavigation(t)} />
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
          onStartNavigation={() => handleStartNavigation(selected)}
          onCompleted={handleTaskCompleted}
          toast={showToast}
        />
      )}

      {navTask && (
        <WorkerNavigationModal
          task={navTask}
          workerProfile={profile}
          onClose={() => setNavTask(null)}
          onArrivedOnSite={handleArrivedOnSite}
          onGpsUpdate={updateLocation}
        />
      )}

      {toast && <div className="toast-container"><Toast toast={toast} /></div>}
    </div>
  )
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────
function TaskCard({ task, onClick, onStatus, onNavigate, completed }) {
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
            {task.ai_rating && <span className="badge" style={{ background: 'var(--success-soft)', color: 'var(--accent)' }}>Score {task.ai_rating}</span>}
          </div>
          {sla && !completed && (
            <div className="sla-cell" style={{ marginTop: 8 }}>
              <div className="sla-bar"><div className="sla-fill" style={{ width: `${sla.percent}%`, background: sla.color }} /></div>
            </div>
          )}
        </>
      )}
      {!completed && task.status === 'Assigned' && (
        <button
          className="btn btn-primary btn-sm"
          style={{ marginTop: 10, width: '100%' }}
          onClick={(e) => { e.stopPropagation(); onNavigate ? onNavigate() : onClick() }}
        >
          <Icon name="Navigation" size={14} /> Start navigation
        </button>
      )}
      {!completed && task.status === 'En route' && (
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 10, width: '100%', border: '1px solid var(--primary)', color: 'var(--primary)' }}
          onClick={(e) => { e.stopPropagation(); onNavigate ? onNavigate() : onClick() }}
        >
          <span className="nav-active-badge"><Icon name="Navigation" size={12} /> En route — Open map</span>
        </button>
      )}
    </div>
  )
}

// ─── TaskDrawer ───────────────────────────────────────────────────────────────
function TaskDrawer({ task, onClose, onStatus, onStartNavigation, onCompleted, toast }) {
  const [afterPhoto, setAfterPhoto] = useState(null)
  const [afterUrl, setAfterUrl] = useState(null)
  const [afterNote, setAfterNote] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const report = task.report

  function handlePhoto(file) {
    setAfterPhoto(file)
    setAfterUrl(URL.createObjectURL(file))
    setVerifyResult(null) // reset verification if re-uploading
  }

  async function handleVerify() {
    if (!afterPhoto) {
      toast('Please upload an after photo first.', 'error')
      return
    }
    setVerifying(true)
    try {
      const afterDataUrl = await toDataUrl(afterPhoto)
      const res = await fetch(`${API_BASE}/api/agents/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, afterImageDataUrl: afterDataUrl, workerNote: afterNote }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Verification failed.')
      setVerifyResult(data)
    } catch (err) {
      toast(err.message || 'Verification failed.', 'error')
    }
    setVerifying(false)
  }

  async function handleConfirmSubmit() {
    // The verification agent already wrote to DB when it passed, just refresh the UI
    setSubmitting(true)
    // Fetch fresh task state from server
    const { data } = await api.from('swachhlens_tasks').select('*, report:swachhlens_reports(*)').eq('id', task.id).single()
    setSubmitting(false)
    if (data) {
      onCompleted(data)
    } else {
      onCompleted({ ...task, status: 'Completed', completion_score: verifyResult?.overall_score || 75 })
    }
  }

  const beforeUrl = report?.image_url || null

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
          {/* Task details */}
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

          {/* Before photo */}
          {beforeUrl && (
            <div className="detail-section">
              <div className="detail-label">Before photo (from citizen)</div>
              <div className="image-placeholder"><img src={beforeUrl} alt="Before" /></div>
            </div>
          )}

          {/* Site map */}
          {report?.latitude && (
            <div className="detail-section">
              <div className="detail-label">Site location</div>
              <MapView reports={[{ ...report, approval_status: 'Approved' }]} center={[report.latitude, report.longitude]} zoom={16} height={220} />
            </div>
          )}

          {/* Submission — only when On site */}
          {task.status === 'On site' && (
            <div className="detail-section">
              <div className="detail-label">Submit cleanup evidence</div>

              <div className="form-group">
                <label>After photo <span style={{ color: '#ef4444' }}>*</span></label>
                {afterUrl ? (
                  <div className="image-placeholder" style={{ position: 'relative' }}>
                    <img src={afterUrl} alt="After" />
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.5)', color: '#fff' }}
                      onClick={() => { setAfterPhoto(null); setAfterUrl(null); setVerifyResult(null) }}
                    >
                      <Icon name="X" size={12} /> Re-upload
                    </button>
                  </div>
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
                <Icon name="Sparkles" size={12} /> AI will compare before &amp; after photos to verify cleanup quality.
              </p>
            </div>
          )}

          {/* Completed task AI rating */}
          {(task.status === 'Completed' || task.status === 'Verified') && task.ai_rating != null && (
            <div className="detail-section">
              <div className="detail-label">AI verification result</div>
              <div className="rating-display">
                <div className="rating-score" style={{ color: task.ai_rating >= 80 ? '#16a34a' : task.ai_rating >= 60 ? '#f59e0b' : '#ef4444' }}>
                  {task.ai_rating}<span>/100</span>
                </div>
                <div className="rating-bar"><div className="rating-fill" style={{ width: `${task.ai_rating}%`, background: task.ai_rating >= 80 ? '#16a34a' : task.ai_rating >= 60 ? '#f59e0b' : '#ef4444' }} /></div>
              </div>
              {task.ai_feedback && <p style={{ fontSize: 13, marginTop: 8 }} className="muted">{task.ai_feedback}</p>}
              {task.worker_note && <p style={{ fontSize: 13, marginTop: 4 }} className="muted">{task.worker_note}</p>}
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {task.status === 'Assigned' && (
            <button className="btn btn-primary" onClick={onStartNavigation}>
              <Icon name="Navigation" size={16} /> Start Navigation
            </button>
          )}
          {task.status === 'En route' && (
            <button className="btn btn-primary" onClick={onStartNavigation}>
              <Icon name="Navigation" size={16} /> Open Live Map
            </button>
          )}
          {task.status === 'On site' && (
            <button
              className="btn btn-success"
              onClick={handleVerify}
              disabled={verifying || !afterPhoto}
            >
              <Icon name="Sparkles" size={16} />
              {verifying ? 'Verifying with AI…' : 'Verify Cleanup'}
            </button>
          )}
        </div>
      </div>

      {/* Verification Modal */}
      {verifyResult && (
        <VerificationModal
          result={verifyResult}
          beforeUrl={beforeUrl}
          afterUrl={afterUrl}
          onRetry={() => setVerifyResult(null)}
          onConfirm={handleConfirmSubmit}
          submitting={submitting}
        />
      )}
    </>
  )
}
