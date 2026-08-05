import { useEffect, useState } from 'react'
import { api, REPORT_CATEGORIES, generateReferenceCode } from '../lib/api/index.js'
import { analyzeReport } from '../lib/ai'
import { uploadEvidence } from '../lib/storage'
import { Icon, Toast } from './ui'
import MapView from './MapView'
import { statusColors, formatRelativeTime, getSlaStatus } from '../lib/constants'

const STEPS = ['capture', 'analyzing', 'review', 'submitting', 'done']

export default function CitizenPortal({ onBackToSignIn }) {
  const [step, setStep] = useState('capture')
  const [photo, setPhoto] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [gps, setGps] = useState(null)
  const [gpsError, setGpsError] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [phone, setPhone] = useState('')
  const [analysis, setAnalysis] = useState(null)
  const [submittedRef, setSubmittedRef] = useState(null)
  const [myReports, setMyReports] = useState([])
  const [toast, setToast] = useState(null)
  const [view, setView] = useState('report')

  function showToast(message, type = 'info') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        (err) => setGpsError(err.message || 'Location permission denied'),
        { enableHighAccuracy: true, timeout: 10000 },
      )
    } else {
      setGpsError('GPS not supported on this device.')
    }
    loadMyReports()
  }, [])

  function loadMyReports() {
    const key = 'swachhlens_citizen_refs'
    const refs = JSON.parse(localStorage.getItem(key) || '[]')
    if (refs.length === 0) return
    api
      .from('swachhlens_reports')
      .select('*')
      .in('reference_code', refs)
      .order('reported_at', { ascending: false })
      .then(({ data }) => setMyReports(data || []))
  }

  function handlePhoto(file) {
    setPhoto(file)
    setPhotoUrl(URL.createObjectURL(file))
    setStep('analyzing')
    // Simulate AI analysis delay
    setTimeout(() => {
      const result = analyzeReport({ description, category, hazard_flag: false })
      setAnalysis(result)
      if (result.category) setCategory(result.category)
      setStep('review')
    }, 1600)
  }

  async function submitReport() {
    setStep('submitting')
    let imageUrl = null
    if (photo) {
      const { url, error } = await uploadEvidence(photo, 'citizen')
      if (!error) imageUrl = url
    }
    const ref = generateReferenceCode()
    const row = {
      reference_code: ref,
      category: analysis.category || category,
      location: gps ? `GPS ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'Location unknown',
      zone: 'Central',
      latitude: gps?.lat,
      longitude: gps?.lng,
      volume: analysis.volume,
      severity_score: analysis.severity_score,
      priority: analysis.priority,
      hazard_flag: analysis.hazard,
      confidence: analysis.confidence,
      team_size: analysis.team_size,
      description: description || analysis.summary,
      resident_name: 'Citizen',
      citizen_phone: phone,
      image_url: imageUrl,
      ai_analysis: analysis,
      status: 'New',
      approval_status: analysis.autoApproved ? 'Auto-approved' : 'Pending',
      citizen_update: analysis.autoApproved
        ? 'Report auto-approved and queued for worker assignment.'
        : 'Report received and awaiting operator review.',
    }
    const { data, error } = await api.from('swachhlens_reports').insert(row).select().single()
    if (error) {
      showToast('Could not submit report. Please try again.', 'error')
      setStep('review')
      return
    }
    const key = 'swachhlens_citizen_refs'
    const refs = JSON.parse(localStorage.getItem(key) || '[]')
    refs.push(ref)
    localStorage.setItem(key, JSON.stringify(refs))
    setSubmittedRef(ref)
    setStep('done')
    loadMyReports()
  }

  function reset() {
    setStep('capture')
    setPhoto(null)
    setPhotoUrl(null)
    setDescription('')
    setCategory('')
    setAnalysis(null)
    setSubmittedRef(null)
  }

  return (
    <div className="citizen-app">
      <header className="citizen-header">
        <div className="brand">
          <div className="brand-mark"><Icon name="Leaf" size={20} /></div>
          <div>SwachhLens <span className="brand-sub">Citizen</span></div>
        </div>
        <div className="citizen-header-actions">
          <button className={`citizen-tab ${view === 'report' ? 'active' : ''}`} onClick={() => setView('report')}>Report</button>
          <button className={`citizen-tab ${view === 'track' ? 'active' : ''}`} onClick={() => setView('track')}>
            My reports {myReports.length > 0 && <span className="nav-badge">{myReports.length}</span>}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onBackToSignIn}><Icon name="LogOut" size={14} /> Staff login</button>
        </div>
      </header>

      <main className="citizen-main">
        {view === 'track' ? (
          <TrackView reports={myReports} onNew={() => { setView('report'); reset() }} />
        ) : (
          <div className="citizen-report-flow">
            {step === 'capture' && (
              <CaptureStep
                photoUrl={photoUrl}
                gps={gps}
                gpsError={gpsError}
                description={description}
                setDescription={setDescription}
                category={category}
                setCategory={setCategory}
                onPhoto={handlePhoto}
              />
            )}

            {step === 'analyzing' && (
              <div className="analyzing-card">
                <div className="spinner" />
                <h3>Analyzing your photo…</h3>
                <p className="muted">AI is detecting waste type, volume, and severity to prioritize the cleanup.</p>
              </div>
            )}

            {step === 'review' && analysis && (
              <ReviewStep
                photoUrl={photoUrl}
                analysis={analysis}
                category={category}
                setCategory={setCategory}
                description={description}
                setDescription={setDescription}
                phone={phone}
                setPhone={setPhone}
                gps={gps}
                onSubmit={submitReport}
                onBack={reset}
              />
            )}

            {step === 'submitting' && (
              <div className="analyzing-card">
                <div className="spinner" />
                <h3>Submitting your report…</h3>
                <p className="muted">Uploading evidence and sending to the operations dashboard.</p>
              </div>
            )}

            {step === 'done' && (
              <DoneStep ref={submittedRef} analysis={analysis} onNew={reset} onTrack={() => setView('track')} />
            )}
          </div>
        )}
      </main>

      {toast && <div className="toast-container"><Toast toast={toast} /></div>}
    </div>
  )
}

function CaptureStep({ photoUrl, gps, gpsError, description, setDescription, category, setCategory, onPhoto }) {
  return (
    <div className="capture-grid">
      <div className="capture-left">
        <div className="panel">
          <div className="panel-header"><h3 className="panel-title">1. Capture the waste</h3></div>
          <div className="panel-body">
            {photoUrl ? (
              <div className="image-placeholder"><img src={photoUrl} alt="Evidence" /></div>
            ) : (
              <label className="capture-zone">
                <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files[0] && onPhoto(e.target.files[0])} hidden />
                <Icon name="Camera" size={40} />
                <h3>Take or upload a photo</h3>
                <p className="muted">Point at the overflowing bin, dumpsite, or waste issue.</p>
              </label>
            )}
            {photoUrl && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => document.querySelector('input[type=file]').click()}>
                <Icon name="RefreshCw" size={14} /> Retake
              </button>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h3 className="panel-title">2. Location &amp; details</h3></div>
          <div className="panel-body">
            <div className="form-group">
              <label>What did you see? (optional — AI will detect from photo)</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Bin near the bus stop has been overflowing for 3 days" />
            </div>
            <div className="form-group">
              <label>Category (optional)</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Let AI decide</option>
                {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="gps-status">
              {gps ? (
                <>
                  <Icon name="MapPin" size={16} color="#16a34a" />
                  <span>GPS locked: {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)} (±{Math.round(gps.accuracy)}m)</span>
                </>
              ) : gpsError ? (
                <>
                  <Icon name="MapPinOff" size={16} color="#ef4444" />
                  <span>{gpsError} — you can still submit without GPS.</span>
                </>
              ) : (
                <>
                  <div className="spinner" style={{ width: 16, height: 16 }} />
                  <span>Fetching GPS location…</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="capture-right">
        <div className="panel">
          <div className="panel-header"><h3 className="panel-title">Your location</h3></div>
          <div className="panel-body">
            {gps ? (
              <MapView reports={[]} center={[gps.lat, gps.lng]} zoom={15} height={300} />
            ) : (
              <div className="image-placeholder" style={{ height: 300 }}>
                <div><Icon name="MapPinOff" size={28} /><div style={{ fontSize: 13, marginTop: 6 }}>Waiting for GPS…</div></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ReviewStep({ photoUrl, analysis, category, setCategory, description, setDescription, phone, setPhone, gps, onSubmit, onBack }) {
  return (
    <div className="review-grid">
      <div className="panel">
        <div className="panel-header"><h3 className="panel-title">AI analysis result</h3></div>
        <div className="panel-body">
          <div className="ai-result-card">
            {photoUrl && <div className="image-placeholder" style={{ marginBottom: 14 }}><img src={photoUrl} alt="Evidence" /></div>}
            <div className="ai-row"><span className="muted">Detected category</span><strong>{analysis.category}</strong></div>
            <div className="ai-row"><span className="muted">Estimated volume</span><strong>{analysis.volume}</strong></div>
            <div className="ai-row"><span className="muted">Severity score</span><strong>{analysis.severity_score}/100</strong></div>
            <div className="ai-row"><span className="muted">Priority</span><span className="badge" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>{analysis.priority}</span></div>
            <div className="ai-row"><span className="muted">Recommended team</span><strong>{analysis.team_size} worker{analysis.team_size > 1 ? 's' : ''}</strong></div>
            <div className="ai-row"><span className="muted">Hazard flagged</span><strong>{analysis.hazard ? 'Yes' : 'No'}</strong></div>
            <div className="ai-row"><span className="muted">AI confidence</span><strong>{analysis.confidence}%</strong></div>
            <p className="ai-summary">{analysis.summary}</p>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h3 className="panel-title">Confirm &amp; submit</h3></div>
        <div className="panel-body">
          <div className="form-group">
            <label>Adjust category if needed</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Add more detail (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything else the crew should know" />
          </div>
          <div className="form-group">
            <label>Your phone (for updates, optional)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" />
          </div>
          {analysis.autoApproved && (
            <div className="auto-approve-banner">
              <Icon name="Zap" size={16} /> High-severity hazard — this report will be auto-approved for faster response.
            </div>
          )}
          <div className="row-gap" style={{ marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={onBack}><Icon name="ArrowLeft" size={16} /> Back</button>
            <button className="btn btn-primary" onClick={onSubmit}><Icon name="Send" size={16} /> Submit report</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DoneStep({ ref: refCode, analysis, onNew, onTrack }) {
  return (
    <div className="done-card">
      <div className="done-icon"><Icon name="CheckCircle2" size={48} color="#16a34a" /></div>
      <h2>Report submitted!</h2>
      <p className="muted">Your reference code</p>
      <div className="done-ref">{refCode}</div>
      <p className="muted">Save this to track your report status. The operations team has been notified.</p>
      {analysis && (
        <div className="done-summary">
          <div className="ai-row"><span className="muted">Category</span><strong>{analysis.category}</strong></div>
          <div className="ai-row"><span className="muted">Priority</span><strong>{analysis.priority}</strong></div>
          <div className="ai-row"><span className="muted">Status</span><strong>{analysis.autoApproved ? 'Auto-approved' : 'Pending review'}</strong></div>
        </div>
      )}
      <div className="row-gap" style={{ justifyContent: 'center', marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={onTrack}><Icon name="List" size={16} /> Track my reports</button>
        <button className="btn btn-primary" onClick={onNew}><Icon name="Plus" size={16} /> Report another</button>
      </div>
    </div>
  )
}

function TrackView({ reports, onNew }) {
  return (
    <div className="track-view">
      <div className="track-header">
        <h2>Your reports</h2>
        <button className="btn btn-primary" onClick={onNew}><Icon name="Plus" size={16} /> New report</button>
      </div>
      {reports.length === 0 ? (
        <div className="empty">
          <Icon name="Inbox" size={36} />
          <h3>No reports yet</h3>
          <p>Submit your first waste report to see it tracked here.</p>
        </div>
      ) : (
        <div className="track-list">
          {reports.map((r) => {
            const sla = getSlaStatus(r)
            return (
              <div key={r.id} className="track-card">
                <div className="track-card-top">
                  <span className="ref-code">{r.reference_code}</span>
                  <span className="badge" style={{ background: `${statusColors[r.status]}1a`, color: statusColors[r.status] }}>
                    <span className="badge-dot" style={{ background: statusColors[r.status] }} /> {r.status}
                  </span>
                </div>
                <div className="track-card-body">
                  <strong>{r.category}</strong>
                  <p className="muted">{r.location}</p>
                  <div className="track-card-meta">
                    <span>Reported {formatRelativeTime(r.reported_at)}</span>
                    {r.approval_status === 'Pending' && <span className="tag tag-hazard"><Icon name="Clock" size={11} /> Awaiting approval</span>}
                    {r.approval_status === 'Auto-approved' && <span className="tag" style={{ background: 'var(--success-soft)', color: 'var(--accent)' }}><Icon name="Zap" size={11} /> Auto-approved</span>}
                    {r.approval_status === 'Approved' && <span className="tag" style={{ background: 'var(--success-soft)', color: 'var(--accent)' }}><Icon name="Check" size={11} /> Approved</span>}
                  </div>
                  <div className="citizen-update">{r.citizen_update}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
