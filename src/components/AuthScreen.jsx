import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { Icon } from './ui'
import { api, ZONES } from '../lib/api/index.js'

const DEMO_PRESETS = [
  { label: 'Bengaluru (BBMP) Operator', email: 'operator@swachhlens.local', role: 'operator', icon: 'Building2', color: '#6366f1' },
  { label: 'Bengaluru Squad (Worker)', email: 'green@squad.local', role: 'worker', icon: 'HardHat', color: '#16a34a' },
  { label: 'Bhubaneswar (BMC) Worker', email: 'bbsr@squad.local', role: 'worker', icon: 'MapPin', color: '#0ea5e9' },
]

export default function AuthScreen({ onCitizen }) {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin')
  const [role, setRole] = useState('operator')
  const [municipalities, setMunicipalities] = useState([])
  const [form, setForm] = useState({
    email: '',
    password: '',
    full_name: '',
    phone: '',
    zone: 'Central',
    municipality_id: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Load municipalities for the signup dropdown
    api
      .from('municipalities')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setMunicipalities(data)
          setForm((f) => ({ ...f, municipality_id: f.municipality_id || data[0].id }))
        }
      })
      .catch(() => {})
  }, [])

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleDemoLogin(preset) {
    setBusy(true)
    setError('')
    setForm((f) => ({ ...f, email: preset.email, password: 'Swachh123!' }))
    const { error: err } = await signIn({ email: preset.email, password: 'Swachh123!' })
    if (err) setError(err.message || 'Demo login failed.')
    setBusy(false)
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    if (mode === 'signin') {
      const { error: err } = await signIn({ email: form.email, password: form.password })
      if (err) setError(err.message.includes('Invalid login') ? 'Incorrect email or password.' : err.message)
    } else {
      if (!form.full_name.trim()) {
        setError('Please enter your name.')
        setBusy(false)
        return
      }
      const { error: err } = await signUp({
        ...form,
        role,
        municipality_id: form.municipality_id || null,
      })
      if (err) setError(err.message.includes('already') ? 'An account with this email already exists.' : err.message)
      else setError('Account created! Try signing in now.')
    }
    setBusy(false)
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark"><Icon name="Leaf" size={24} /></div>
          <h1>SwachhLens</h1>
          <p>Civic waste operations — municipal operators, field workers & citizens.</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
        </div>

        {mode === 'signin' && (
          <div className="auth-demo-presets">
            <div className="demo-presets-label">⚡ 1-Click Demo Profiles</div>
            <div className="demo-presets-grid">
              {DEMO_PRESETS.map((preset) => (
                <button
                  key={preset.email}
                  type="button"
                  className="demo-preset-btn"
                  onClick={() => handleDemoLogin(preset)}
                  disabled={busy}
                >
                  <span className="demo-preset-dot" style={{ background: preset.color }} />
                  <div className="demo-preset-text">
                    <strong>{preset.label}</strong>
                    <small>{preset.email}</small>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <div className="auth-role">
              <button type="button" className={role === 'operator' ? 'active' : ''} onClick={() => setRole('operator')}>
                <Icon name="LayoutDashboard" size={18} /> Operator
                <small>Municipality / ULB office</small>
              </button>
              <button type="button" className={role === 'worker' ? 'active' : ''} onClick={() => setRole('worker')}>
                <Icon name="HardHat" size={18} /> Worker
                <small>Field cleanup squad</small>
              </button>
            </div>
          )}

          {mode === 'signup' && (
            <div className="form-group">
              <label>Full name</label>
              <input value={form.full_name} onChange={(e) => update('full_name', e.target.value)} placeholder="Your name" required />
            </div>
          )}

          {mode === 'signup' && role === 'operator' && (
            <div className="form-group">
              <label>Municipality / Urban Local Body</label>
              <select
                value={form.municipality_id}
                onChange={(e) => update('municipality_id', e.target.value)}
                required
              >
                {municipalities.length === 0 ? (
                  <>
                    <option value="">Bengaluru (BBMP)</option>
                    <option value="">Bhubaneswar (BMC)</option>
                    <option value="">Pune (PMC)</option>
                  </>
                ) : (
                  municipalities.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.city}, {m.state})
                    </option>
                  ))
                )}
              </select>
              <small className="form-help">Reports in this municipality will be scoped to your dashboard.</small>
            </div>
          )}

          <div className="form-group">
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="officer@city.gov.in" required />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="At least 6 characters" required minLength={6} />
          </div>

          {mode === 'signup' && role === 'worker' && (
            <>
              <div className="form-group">
                <label>Phone</label>
                <input value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="Mobile number" />
              </div>
              <div className="form-group">
                <label>Home zone</label>
                <select value={form.zone} onChange={(e) => update('zone', e.target.value)}>
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="auth-citizen">
          <p>Are you a citizen reporting waste?</p>
          <button className="btn btn-ghost" onClick={onCitizen}>
            <Icon name="Camera" size={16} /> Open citizen portal
          </button>
        </div>
      </div>
    </div>
  )
}
