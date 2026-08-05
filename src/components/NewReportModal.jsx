import { useEffect, useState } from 'react'
import { supabase, REPORT_CATEGORIES, ZONES, VOLUME_LEVELS, SEVERITY_BY_VOLUME, PRIORITY_BY_SEVERITY, generateReferenceCode } from '../lib/supabaseClient'
import { analyzeReport } from '../lib/ai'
import { uploadEvidence } from '../lib/storage'
import { Icon } from './ui'

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

  function runAnalysis() {
    const result = analyzeReport({ description: form.description, category: form.category, hazard_flag: form.hazard_flag })
    setAnalysis(result)
    setShowAnalysis(true)
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.location.trim()) { setError('Location is required.'); return }
    setSaving(true)
    setError('')

    let imageUrl = form.image_url || null
    if (photo) {
      const { url } = await uploadEvidence(photo, 'operator')
      if (url) imageUrl = url
    }

    const ai = analysis || analyzeReport({ description: form.description, category: form.category, hazard_flag: form.hazard_flag })
    const severity = ai.severity_score || SEVERITY_BY_VOLUME[form.volume]
    const priority = ai.priority || PRIORITY_BY_SEVERITY(severity)

    const row = {
      reference_code: generateReferenceCode(),
      category: form.category,
      location: form.location.trim(),
      zone: form.zone,
      latitude: gps?.lat,
      longitude: gps?.lng,
      volume: form.volume,
      severity_score: severity,
      priority,
      hazard_flag: form.hazard_flag,
      description: form.description.trim(),
      resident_name: form.resident_name.trim() || 'Operator',
      citizen_phone: form.phone,
      image_url: imageUrl,
      ai_analysis: ai,
      team_size: ai.team_size || 1,
      status: 'New',
      approval_status: 'Approved',
      citizen_update: 'Report logged by operator and queued for assignment.',
    }
    const { data, error: dbError } = await supabase.from('swachhlens_reports').insert(row).select().single()
    setSaving(false)
    if (dbError) { setError('Could not save the report.'); return }
    onCreated(data)
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
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create report'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
