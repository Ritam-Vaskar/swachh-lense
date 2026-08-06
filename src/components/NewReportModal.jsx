import { useEffect, useState } from 'react'
import { api, REPORT_CATEGORIES, ZONES, VOLUME_LEVELS } from '../lib/api/index.js'
import { uploadEvidence } from '../lib/storage'
import { Icon } from './ui'

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

export default function NewReportModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({
    category: REPORT_CATEGORIES[0],
    location: '',
    zone: 'Central',
    volume: 'Medium',
    hazard_flag: false,
    description: '',
    resident_name: '',
    image_url: '',
    phone: '',
  })
  const [gps, setGps] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pipelineStatus, setPipelineStatus] = useState('') // '', 'uploading', 'analyzing', 'done'
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setForm({ category: REPORT_CATEGORIES[0], location: '', zone: 'Central', volume: 'Medium', hazard_flag: false, description: '', resident_name: '', image_url: '', phone: '' })
      setGps(null)
      setPhoto(null)
      setPhotoUrl(null)
      setAnalysis(null)
      setShowAnalysis(false)
      setError('')
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => {},
          { enableHighAccuracy: true, timeout: 8000 },
        )
      }
    }
  }, [open])

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handlePhoto(file) {
    setPhoto(file)
    setPhotoUrl(URL.createObjectURL(file))
  }

  // Preview-only heuristic analysis so operator can see rough numbers before submitting.
  // The real Gemini-powered analysis runs server-side after submission.
  function runAnalysis() {
    const volume = form.volume || 'Medium'
    const volumeScore = { Small: 30, Medium: 50, Large: 75, Overflowing: 95 }[volume] || 50
    const severity = Math.min(100, volumeScore + (form.hazard_flag ? 10 : 0))
    let priority = 'Low'
    if (severity >= 85) priority = 'Critical'
    else if (severity >= 65) priority = 'High'
    else if (severity >= 40) priority = 'Medium'
    const team_size = volume === 'Overflowing' ? 4 : volume === 'Large' ? 3 : volume === 'Medium' ? 2 : 1
    setAnalysis({ severity_score: severity, priority, team_size, confidence: '—', summary: `Quick estimate: ${priority} priority, team of ${team_size}. Final AI analysis runs after submission.` })
    setShowAnalysis(true)
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.location.trim()) { setError('Location is required.'); return }
    setSaving(true)
    setError('')

    // Step 1: Upload photo first if provided
    let imageUrl = form.image_url || null
    if (photo) {
      setPipelineStatus('uploading')
      const { url } = await uploadEvidence(photo, 'operator')
      if (url) imageUrl = url
    }

    // Step 2: Call Intake Agent — validation, DB insert, and async Vision analysis
    setPipelineStatus('analyzing')
    try {
      const result = await callIntakeAgent({
        category: form.category,
        location: form.location.trim(),
        zone: form.zone,
        latitude: gps?.lat ?? null,
        longitude: gps?.lng ?? null,
        volume: form.volume,
        hazard_flag: form.hazard_flag,
        description: form.description.trim(),
        resident_name: form.resident_name.trim() || 'Operator',
        citizen_phone: form.phone,
        image_url: imageUrl,
        source: 'operator',
      })
      setPipelineStatus('done')
      setSaving(false)
      onCreated(result.report)
    } catch (err) {
      setError(err.message || 'Could not save the report.')
      setSaving(false)
      setPipelineStatus('')
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0, fontSize: 18 }}>New civic report</h3>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Intake a waste complaint into the operations workspace.</p>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label>Category</label>
                <select value={form.category} onChange={(e) => update('category', e.target.value)}>
                  {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Zone</label>
                <select value={form.zone} onChange={(e) => update('zone', e.target.value)}>
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Location details</label>
              <input value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="Landmark, street, cross reference" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Waste volume</label>
                <select value={form.volume} onChange={(e) => update('volume', e.target.value)}>
                  {VOLUME_LEVELS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Reporter phone (optional)</label>
                <input value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="Mobile number" />
              </div>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="What is visible at the site?" />
            </div>

            <div className="form-group">
              <label>Evidence photo (optional)</label>
              {photoUrl ? (
                <div className="image-placeholder" style={{ height: 160 }}><img src={photoUrl} alt="Evidence" /></div>
              ) : (
                <label className="capture-zone small">
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files[0] && handlePhoto(e.target.files[0])} hidden />
                  <Icon name="Camera" size={24} />
                  <span>Upload or take photo</span>
                </label>
              )}
            </div>

            <div className="toggle-row">
              <span>Flag as health/safety hazard</span>
              <button type="button" className={`switch ${form.hazard_flag ? 'on' : ''}`} onClick={() => update('hazard_flag', !form.hazard_flag)} aria-label="Toggle hazard" />
            </div>

            <div className="gps-status" style={{ marginTop: 12 }}>
              {gps ? (
                <><Icon name="MapPin" size={16} color="#16a34a" /><span>GPS: {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</span></>
              ) : (
                <><Icon name="MapPinOff" size={16} color="#94a3b8" /><span>No GPS — report will have no map pin.</span></>
              )}
            </div>

            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={runAnalysis}>
              <Icon name="Sparkles" size={14} /> Run AI triage analysis
            </button>
            {showAnalysis && analysis && (
              <div className="ai-result-card" style={{ marginTop: 10 }}>
                <div className="ai-row"><span className="muted">Severity</span><strong>{analysis.severity_score}/100</strong></div>
                <div className="ai-row"><span className="muted">Priority</span><strong>{analysis.priority}</strong></div>
                <div className="ai-row"><span className="muted">Team size</span><strong>{analysis.team_size}</strong></div>
                <div className="ai-row"><span className="muted">Confidence</span><strong>{analysis.confidence}%</strong></div>
                <p className="ai-summary">{analysis.summary}</p>
              </div>
            )}

            {error && <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? pipelineStatus === 'uploading'
                  ? <><Icon name="Upload" size={14} /> Uploading photo…</>
                  : pipelineStatus === 'analyzing'
                    ? <><Icon name="Sparkles" size={14} /> AI analyzing…</>
                    : 'Saving…'
                : <><Icon name="Plus" size={14} /> Create report</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
