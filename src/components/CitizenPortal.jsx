import { useEffect, useState } from 'react'
import { api, REPORT_CATEGORIES, generateReferenceCode } from '../lib/api/index.js'
import { uploadEvidence } from '../lib/storage'
import { Icon, Toast } from './ui'
import MapView from './MapView'
import { statusColors, formatRelativeTime, getSlaStatus } from '../lib/constants'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

async function callIntakeAgent(payload) {
  const res = await fetch(`${API_BASE}/api/agents/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Intake agent failed')
  return data
}

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
  const [uploadedImageUrl, setUploadedImageUrl] = useState(null)
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
    setUploadedImageUrl(null)
  }

  async function analyzePhoto() {
    if (!photo) return
    setStep('analyzing')

    let urlToUse = uploadedImageUrl
    if (!urlToUse) {
      const { url, error } = await uploadEvidence(photo, 'citizen')
      if (error || !url) {
        showToast('Failed to upload photo.', 'error')
        setStep('capture')
        return
      }
      urlToUse = url
      setUploadedImageUrl(url)
    }

    try {
      const res = await fetch(`${API_BASE}/api/agents/vision/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: urlToUse, description, category }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to analyze')

      setAnalysis(data.analysis)
      if (data.analysis.is_waste === false) {
        setStep('rejected')
      } else {
        if (data.analysis.category) setCategory(data.analysis.category)
        setStep('review')
      }
    } catch (err) {
      showToast('AI analysis failed. You can still submit manually.', 'error')
      setStep('review')
    }
  }

  async function submitReport() {
    setStep('submitting')

    try {
      const result = await callIntakeAgent({
        category: category || '',
        location: gps ? `GPS ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : '',
        latitude: gps?.lat ?? null,
        longitude: gps?.lng ?? null,
        description: description || '',
        resident_name: 'Citizen',
        citizen_phone: phone,
        image_url: uploadedImageUrl,
        source: 'citizen',
        zone: 'Central',
        ai_analysis: analysis
      })

      // Store reference in localStorage for tracking
      const ref = result.report.reference_code
      const key = 'swachhlens_citizen_refs'
      const refs = JSON.parse(localStorage.getItem(key) || '[]')
      refs.push(ref)
      localStorage.setItem(key, JSON.stringify(refs))

      // Show a placeholder analysis object for the Done screen
      setAnalysis({
        category: result.report.category,
        priority: result.report.priority,
        autoApproved: result.report.approval_status === 'Auto-approved',
      })
      setSubmittedRef(ref)
      setStep('done')
      loadMyReports()
    } catch (err) {
      showToast(err.message || 'Could not submit report. Please try again.', 'error')
      setStep('review')
    }
  }

  function reset() {
    setStep('capture')
    setPhoto(null)
    setPhotoUrl(null)
    setDescription('')
    setCategory('')
    setAnalysis(null)
    setSubmittedRef(null)
    setUploadedImageUrl(null)
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
                onNext={analyzePhoto}
              />
            )}

            {step === 'analyzing' && (
              <div className="analyzing-card">
                <div className="spinner" />
                <h3>Analyzing your photo…</h3>
                <p className="muted">AI is detecting waste type, volume, and severity to prioritize the cleanup.</p>
              </div>
            )}

            {step === 'review' && (
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
                onBack={() => setStep('capture')}
              />
            )}

            {step === 'rejected' && (
              <div className="analyzing-card" style={{ padding: '40px 20px', textAlign: 'center' }}>
                <Icon name="XCircle" size={48} color="#ef4444" />
                <h3 style={{ marginTop: 16 }}>Image Rejected</h3>
                <p className="muted" style={{ maxWidth: 400, margin: '10px auto' }}>
                  Our AI determined this image does not depict waste or is unrelated to city cleanliness.
                </p>
                {analysis?.reasoning && (
                  <div style={{ background: 'var(--surface-muted)', padding: 12, borderRadius: 8, marginTop: 16, textAlign: 'left', fontSize: 14 }}>
                    <strong>AI Reasoning:</strong> {analysis.reasoning}
                  </div>
                )}
                <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => { setStep('capture'); setPhoto(null); setPhotoUrl(null) }}>
                  <Icon name="Camera" size={16} /> Retake Photo
                </button>
              </div>
            )}

            {step === 'submitting' && (
              <div className="analyzing-card">
                <div className="spinner" />
                <h3>Submitting your report…</h3>
                <p className="muted">Uploading evidence and sending to the AI analysis pipeline. You’ll receive a reference code in a moment.</p>
              </div>
            )}

            {step === 'done' && (
              <DoneStep referenceCode={submittedRef} analysis={analysis} onNew={reset} onTrack={() => setView('track')} />
            )}
          </div>
        )}
      </main>

      {toast && <div className="toast-container"><Toast toast={toast} /></div>}
    </div>
  )
}

function CaptureStep({ photoUrl, gps, gpsError, description, setDescription, category, setCategory, onPhoto, onNext }) {
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
            
            {photoUrl && (
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 20, padding: 14, fontSize: 16 }} onClick={onNext}>
                Analyze &amp; Continue <Icon name="ArrowRight" size={16} />
              </button>
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
        <div className="panel-header"><h3 className="panel-title">Evidence preview</h3></div>
        <div className="panel-body">
          <div className="ai-result-card">
            {photoUrl && <div className="image-placeholder" style={{ marginBottom: 14 }}><img src={photoUrl} alt="Evidence" /></div>}
            {analysis ? (
              <>
                <div className="ai-row"><span className="muted">Detected category</span><strong>{analysis.category}</strong></div>
                <div className="ai-row"><span className="muted">Estimated volume</span><strong>{analysis.volume || '—'}</strong></div>
                <div className="ai-row"><span className="muted">Severity score</span><strong>{analysis.severity_score ? `${analysis.severity_score}/100` : '—'}</strong></div>
                <div className="ai-row"><span className="muted">Priority</span><span className="badge" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>{analysis.priority}</span></div>
                {analysis.team_size && <div className="ai-row"><span className="muted">Recommended team</span><strong>{analysis.team_size} worker{analysis.team_size > 1 ? 's' : ''}</strong></div>}
                <div className="ai-row"><span className="muted">Hazard flagged</span><strong>{analysis.hazard_flag ? 'Yes' : 'No'}</strong></div>
                {analysis.reasoning && (
                  <div className="ai-row" style={{ flexDirection: 'column', alignItems: 'flex-start', borderBottom: 'none', paddingBottom: 0 }}>
                    <span className="muted" style={{ marginBottom: 4 }}>AI Reasoning</span>
                    <strong style={{ fontSize: 13, lineHeight: 1.4 }}>{analysis.reasoning}</strong>
                  </div>
                )}
                {analysis.summary && <p className="ai-summary" style={{ marginTop: 12 }}>{analysis.summary}</p>}
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h3 className="panel-title">Confirm &amp; submit</h3></div>
        <div className="panel-body">
          <div className="form-group">
            <label>Adjust category if needed</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Let AI decide</option>
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
          {gps ? (
            <div className="gps-status" style={{ marginBottom: 8 }}>
              <Icon name="MapPin" size={14} color="#16a34a" />
              <span>GPS confirmed: {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</span>
            </div>
          ) : (
            <div className="gps-status" style={{ marginBottom: 8 }}>
              <Icon name="MapPinOff" size={14} color="#f59e0b" />
              <span>No GPS — report will not have a map pin.</span>
            </div>
          )}
          {analysis?.autoApproved && (
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

function DoneStep({ referenceCode, analysis, onNew, onTrack }) {
  return (
    <div className="done-card">
      <div className="done-icon"><Icon name="CheckCircle2" size={48} color="#16a34a" /></div>
      <h2>Report submitted!</h2>
      <p className="muted">Your reference code</p>
      <div className="done-ref">{referenceCode}</div>
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
