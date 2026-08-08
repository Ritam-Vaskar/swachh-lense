import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api/index.js'
import { useAuth } from '../lib/auth'
import { Icon, Toast } from './ui'
import MapView from './MapView'
import { statusColors, priorityColors, formatRelativeTime, formatDate, getSlaStatus } from '../lib/constants'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

// ---------------------------------------------------------------------------
// Utility: read a File as a base64 data URL
// ---------------------------------------------------------------------------
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

// ---------------------------------------------------------------------------
// WorkerDashboard root
// ---------------------------------------------------------------------------
export default function WorkerDashboard({ onSignOut }) {
  const { profile, signOut } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState(null)
  const [view, setView] = useState('list')

  function showToast(message, type = 'info') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
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
    const sub = api
      .channel('worker-tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'swachhlens_tasks', filter: `worker_id=eq.${profile?.id}` }, () => loadTasks())
      .subscribe()
    return () => api.removeChannel(sub)
  }, [loadTasks, profile])

  // Live GPS tracking
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
    setSelected((s) => s ? { ...s, status } : s)
    showToast(`Task marked ${status}.`, 'success')
  }

  // Called after a successful verification is fully committed by the server
  function onVerificationComplete(taskId, verificationResult) {
    setTasks((t) => t.map((x) =>
      x.id === taskId
        ? {
            ...x,
            status: 'Completed',
            ai_rating: verificationResult.overall_score,
            completion_score: verificationResult.overall_score,
            ai_feedback: verificationResult.ai_feedback,
          }
        : x,
    ))
    setSelected(null)
    showToast(`Cleanup verified ✓  AI score: ${verificationResult.overall_score}/100`, 'success')
  }

  const active    = tasks.filter((t) => t.status !== 'Completed' && t.status !== 'Verified' && t.status !== 'Cancelled')
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
          onVerificationComplete={onVerificationComplete}
          toast={showToast}
        />
      )}

      {toast && <div className="toast-container"><Toast toast={toast} /></div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TaskCard
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// TaskDrawer — side drawer with verification flow
// ---------------------------------------------------------------------------
function TaskDrawer({ task, onClose, onStatus, onVerificationComplete, toast }) {
  const [afterFile, setAfterFile] = useState(null)
  const [afterPreviewUrl, setAfterPreviewUrl] = useState(null)   // blob URL for local preview
  const [afterDataUrl, setAfterDataUrl]     = useState(null)     // base64 data URL for API
  const [afterNote, setAfterNote] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verificationResult, setVerificationResult] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const report = task.report

  function handlePhoto(file) {
    setAfterFile(file)
    setAfterPreviewUrl(URL.createObjectURL(file))
    setVerificationResult(null) // reset previous result when new photo selected
    // Convert to data URL immediately (needed later for API)
    fileToDataUrl(file).then(setAfterDataUrl).catch(() => toast('Could not read image file.', 'error'))
  }

  async function handleVerify() {
    if (!afterDataUrl) {
      toast('Please take or select an after photo first.', 'error')
      return
    }

    setVerifying(true)
    try {
      const response = await fetch(`${API_BASE}/api/agents/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          afterImageDataUrl: afterDataUrl,
          workerNote: afterNote,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Technical/server failure
        const msg = data?.error || 'AI verification is temporarily unavailable. Please try again in a moment.'
        toast(msg, 'error')
        return
      }

      // HTTP 200 — could be passed or failed
      setVerificationResult(data)
      setShowModal(true)
    } catch (err) {
      toast('AI verification is temporarily unavailable. Please try again in a moment.', 'error')
    } finally {
      setVerifying(false)
    }
  }

  function handleTryAgain() {
    setShowModal(false)
    setVerificationResult(null)
    setAfterFile(null)
    setAfterPreviewUrl(null)
    setAfterDataUrl(null)
    setAfterNote('')
  }

  function handleSubmitToMunicipal() {
    // Server already committed the DB update when verification passed.
    // This button just finalises the UI flow.
    onVerificationComplete(task.id, verificationResult)
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
          {report?.image_url && (
            <div className="detail-section">
              <div className="detail-label">Before photo (from citizen)</div>
              <div className="image-placeholder"><img src={report.image_url} alt="Before" /></div>
            </div>
          )}

          {/* Site map */}
          {report?.latitude && (
            <div className="detail-section">
              <div className="detail-label">Site location</div>
              <MapView reports={[{ ...report, approval_status: 'Approved' }]} center={[report.latitude, report.longitude]} zoom={16} height={220} />
            </div>
          )}

          {/* Cleanup submission form — only shown when task is active */}
          {task.status !== 'Completed' && task.status !== 'Verified' && (
            <div className="detail-section">
              <div className="detail-label">Submit cleanup evidence</div>
              <div className="form-group">
                <label>After photo <span style={{ color: 'var(--danger)', fontWeight: 600 }}>*</span></label>
                {afterPreviewUrl ? (
                  <div style={{ position: 'relative' }}>
                    <div className="image-placeholder"><img src={afterPreviewUrl} alt="After" /></div>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 6 }}
                      onClick={() => { setAfterFile(null); setAfterPreviewUrl(null); setAfterDataUrl(null); setVerificationResult(null) }}
                    >
                      <Icon name="RefreshCw" size={13} /> Change photo
                    </button>
                  </div>
                ) : (
                  <label className="capture-zone small" htmlFor="after-photo-input">
                    <input
                      id="after-photo-input"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => e.target.files[0] && handlePhoto(e.target.files[0])}
                      hidden
                    />
                    <Icon name="Camera" size={28} />
                    <span>Take after photo</span>
                  </label>
                )}
              </div>
              <div className="form-group">
                <label>Completion note (optional)</label>
                <textarea value={afterNote} onChange={(e) => setAfterNote(e.target.value)} placeholder="e.g. Bin cleared, area washed and disinfected" />
              </div>
              <p className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="Sparkles" size={12} />
                Gemini Vision AI will compare both photos to verify the cleanup. The task is only marked complete after AI verification passes.
              </p>
            </div>
          )}

          {/* Completed task — show AI rating */}
          {task.ai_rating != null && (
            <div className="detail-section">
              <div className="detail-label">AI verification rating</div>
              <div className="rating-display">
                <div className="rating-score" style={{ color: task.ai_rating >= 80 ? '#16a34a' : task.ai_rating >= 60 ? '#f59e0b' : '#ef4444' }}>
                  {task.ai_rating}<span>/100</span>
                </div>
                <div className="rating-bar"><div className="rating-fill" style={{ width: `${task.ai_rating}%`, background: task.ai_rating >= 80 ? '#16a34a' : task.ai_rating >= 60 ? '#f59e0b' : '#ef4444' }} /></div>
              </div>
              {task.ai_feedback && <p style={{ fontSize: 13, marginTop: 8, lineHeight: 1.6 }} className="muted">{task.ai_feedback}</p>}
              {task.worker_note && <p style={{ fontSize: 13, marginTop: 6 }} className="muted">{task.worker_note}</p>}
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {task.status === 'Assigned' && <button className="btn btn-primary" onClick={() => onStatus('En route')}><Icon name="Navigation" size={16} /> En route</button>}
          {task.status === 'En route' && <button className="btn btn-primary" onClick={() => onStatus('On site')}><Icon name="MapPin" size={16} /> On site</button>}
          {task.status === 'On site' && (
            <button
              className="btn btn-success"
              onClick={handleVerify}
              disabled={verifying || !afterDataUrl}
              id="verify-cleanup-btn"
            >
              {verifying
                ? <><Icon name="Loader2" size={16} style={{ animation: 'spin 1s linear infinite' }} /> Verifying with AI…</>
                : <><Icon name="Sparkles" size={16} /> Verify with AI</>
              }
            </button>
          )}
        </div>
      </div>

      {/* Verification result modal */}
      {showModal && verificationResult && (
        <VerificationModal
          result={verificationResult}
          beforeImageUrl={report?.image_url}
          afterImageUrl={afterPreviewUrl}
          onTryAgain={handleTryAgain}
          onSubmit={handleSubmitToMunicipal}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// VerificationModal
// ---------------------------------------------------------------------------
function VerificationModal({ result, beforeImageUrl, afterImageUrl, onTryAgain, onSubmit }) {
  const { passed } = result
  const scoreColor = result.overall_score >= 80 ? '#16a34a' : result.overall_score >= 60 ? '#f59e0b' : '#ef4444'

  return (
    <div className="verify-modal-overlay" role="dialog" aria-modal="true" aria-label="AI Verification Result">
      <div className="verify-modal">
        {/* Header */}
        <div className={`verify-modal-header ${passed ? 'verify-modal-header--pass' : 'verify-modal-header--fail'}`}>
          <div className="verify-modal-header-icon">
            {passed
              ? <Icon name="ShieldCheck" size={28} />
              : <Icon name="ShieldX" size={28} />
            }
          </div>
          <div>
            <h2 className="verify-modal-title">
              {passed ? 'Cleanup Verified ✓' : 'Verification Failed'}
            </h2>
            <p className="verify-modal-subtitle">
              {passed
                ? 'Gemini AI has confirmed the cleanup is complete.'
                : 'Gemini AI could not confirm the cleanup. See details below.'}
            </p>
          </div>
        </div>

        <div className="verify-modal-body">
          {/* Banner */}
          {passed
            ? (
              <div className="verify-pass-banner">
                <Icon name="CheckCircle2" size={18} />
                Cleanup verified successfully by AI.
              </div>
            )
            : (
              <div className="verify-fail-banner">
                <Icon name="XCircle" size={18} />
                Your work is not verified. Please upload a clearer photo showing the completed cleanup.
              </div>
            )
          }

          {/* Rejection reasons */}
          {!passed && result.rejection_reasons?.length > 0 && (
            <div className="verify-rejection-list">
              <div className="verify-section-label">Rejection reasons</div>
              <ul>
                {result.rejection_reasons.map((reason, i) => (
                  <li key={i}><Icon name="AlertCircle" size={14} /> {reason}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Before / After images */}
          <div className="verify-image-pair">
            <div className="verify-image-box">
              <div className="verify-image-label">BEFORE</div>
              {beforeImageUrl
                ? <img src={beforeImageUrl} alt="Before" className="verify-img" />
                : <div className="verify-img-placeholder"><Icon name="ImageOff" size={32} /><span>No before image</span></div>
              }
            </div>
            <div className="verify-image-box">
              <div className="verify-image-label">AFTER</div>
              {afterImageUrl
                ? <img src={afterImageUrl} alt="After" className="verify-img" />
                : <div className="verify-img-placeholder"><Icon name="ImageOff" size={32} /><span>No after image</span></div>
              }
            </div>
          </div>

          {/* Verification checklist */}
          <div className="verify-checklist">
            <div className="verify-section-label">Verification checklist</div>
            <div className="verify-check-item">
              <span className={`verify-check-icon ${result.is_same_location ? 'pass' : 'fail'}`}>
                {result.is_same_location ? '✅' : '❌'}
              </span>
              <div>
                <strong>Same Location Match</strong>
                <span className="verify-check-sub">Confidence: {result.location_match_confidence}%</span>
              </div>
            </div>
            <div className="verify-check-item">
              <span className={`verify-check-icon ${result.is_cleaned ? 'pass' : 'fail'}`}>
                {result.is_cleaned ? '✅' : '❌'}
              </span>
              <div>
                <strong>Waste Properly Removed</strong>
                <span className="verify-check-sub">Cleaning score: {result.cleaning_score}/100</span>
              </div>
            </div>
            <div className="verify-check-item">
              <span className={`verify-check-icon ${result.is_relevant ? 'pass' : 'fail'}`}>
                {result.is_relevant ? '✅' : '❌'}
              </span>
              <div>
                <strong>Photo is Relevant</strong>
                <span className="verify-check-sub">After photo shows the cleanup site</span>
              </div>
            </div>
          </div>

          {/* Score bar */}
          <div className="verify-score-section">
            <div className="verify-section-label">Completion Score</div>
            <div className="verify-score-display">
              <span className="verify-score-value" style={{ color: scoreColor }}>{result.overall_score}</span>
              <span className="verify-score-denom">/100</span>
            </div>
            <div className="verify-score-bar">
              <div
                className="verify-score-fill"
                style={{ width: `${result.overall_score}%`, background: scoreColor }}
              />
            </div>
            <div className="verify-score-labels">
              <span>0</span>
              <span style={{ color: '#ef4444' }}>Fail (&lt;60)</span>
              <span style={{ color: '#f59e0b' }}>Pass (60–79)</span>
              <span style={{ color: '#16a34a' }}>Good (80+)</span>
              <span>100</span>
            </div>
          </div>

          {/* AI Feedback */}
          <div className="verify-feedback">
            <div className="verify-section-label">AI Feedback</div>
            <p>{result.ai_feedback}</p>
          </div>

          {/* Scene descriptions */}
          <div className="verify-scenes">
            <div className="verify-scene-box">
              <div className="verify-section-label">Before scene</div>
              <p>{result.before_scene_description}</p>
            </div>
            <div className="verify-scene-box">
              <div className="verify-section-label">After scene</div>
              <p>{result.after_scene_description}</p>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="verify-modal-footer">
          {passed ? (
            <>
              <button className="btn btn-ghost" onClick={onTryAgain}>Close</button>
              <button
                className="btn btn-success verify-submit-btn"
                onClick={onSubmit}
                id="submit-to-municipal-btn"
              >
                <Icon name="CheckCircle2" size={18} />
                Submit to Municipal Dashboard ✓
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary verify-retry-btn" onClick={onTryAgain} id="verify-try-again-btn">
                <Icon name="RefreshCw" size={16} />
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
