import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { Icon } from './ui'
import { api, ZONES } from '../lib/api/index.js'

const DEMO_PRESETS = [
  {
    category: 'Super Admin',
    items: [
      {
        label: 'National Super Admin',
        badge: '👑 All Municipalities',
        email: 'superadmin@swachhlens.local',
        password: 'Swachh123!',
        role: 'superadmin',
        icon: 'ShieldCheck',
        color: '#f59e0b',
      },
    ],
  },
  {
    category: 'Municipality Operators',
    items: [
      {
        label: 'Bengaluru (BBMP) Operator',
        badge: '🏛️ BBMP Desk',
        email: 'operator.bengaluru@swachhlens.local',
        password: 'Swachh123!',
        role: 'operator',
        icon: 'Building2',
        color: '#6366f1',
      },
      {
        label: 'Bhubaneswar (BMC) Operator',
        badge: '🏛️ BMC Desk',
        email: 'operator.bhubaneswar@swachhlens.local',
        password: 'Swachh123!',
        role: 'operator',
        icon: 'Building2',
        color: '#0ea5e9',
      },
      {
        label: 'Kolkata (KMC) Operator',
        badge: '🏛️ KMC Desk',
        email: 'operator.kolkata@swachhlens.local',
        password: 'Swachh123!',
        role: 'operator',
        icon: 'Building2',
        color: '#8b5cf6',
      },
      {
        label: 'Pune (PMC) Operator',
        badge: '🏛️ PMC Desk',
        email: 'operator.pune@swachhlens.local',
        password: 'Swachh123!',
        role: 'operator',
        icon: 'Building2',
        color: '#ec4899',
      },
    ],
  },
  {
    category: 'Field Squads',
    items: [
      {
        label: 'Bengaluru Squad (Green A)',
        badge: '👷 Bengaluru',
        email: 'green@squad.local',
        password: 'Swachh123!',
        role: 'worker',
        icon: 'HardHat',
        color: '#16a34a',
      },
      {
        label: 'Bhubaneswar Squad (Patia)',
        badge: '👷 Bhubaneswar',
        email: 'bbsr.patia@squad.local',
        password: 'Swachh123!',
        role: 'worker',
        icon: 'HardHat',
        color: '#0284c7',
      },
      {
        label: 'Kolkata Squad (Salt Lake)',
        badge: '👷 Kolkata',
        email: 'kolkata.saltlake@squad.local',
        password: 'Swachh123!',
        role: 'worker',
        icon: 'HardHat',
        color: '#7c3aed',
      },
    ],
  },
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
  const [gps, setGps] = useState(null)
  const [detectingGps, setDetectingGps] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [presetFilter, setPresetFilter] = useState('all')

  useEffect(() => {
    // Load municipalities for dropdowns and role assignment
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

  function detectLocation() {
    if (!navigator.geolocation) return
    setDetectingGps(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setDetectingGps(false)
      },
      () => {
        setDetectingGps(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  useEffect(() => {
    if (mode === 'signup' && role === 'worker' && !gps) {
      detectLocation()
    }
  }, [mode, role])

  async function handleDemoLogin(preset) {
    setBusy(true)
    setError('')
    setForm((f) => ({ ...f, email: preset.email, password: preset.password }))
    try {
      const { error } = await signIn({ email: preset.email, password: preset.password })
      if (error) {
        const msg = error.message || String(error)
        setError(msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credential') ? 'Incorrect email or password.' : msg)
      }
    } catch (err) {
      setError(err.message || 'An error occurred during demo login.')
    } finally {
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'signin') {
        const { error } = await signIn({ email: form.email, password: form.password })
        if (error) {
          const msg = error.message || String(error)
          setError(msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credential') ? 'Incorrect email or password.' : msg)
        }
      } else {
        if (!form.full_name.trim()) {
          setError('Please enter your name.')
          return
        }
        const { error } = await signUp({
          ...form,
          role,
          municipality_id: role === 'superadmin' ? null : form.municipality_id || null,
          latitude: role === 'worker' ? (gps?.lat ?? null) : null,
          longitude: role === 'worker' ? (gps?.lng ?? null) : null,
        })
        if (error) {
          const msg = error.message || String(error)
          setError(msg.toLowerCase().includes('already') ? 'An account with this email already exists.' : msg)
        }
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 540 }}>
        <div className="auth-brand">
          <div className="brand-mark"><Icon name="Leaf" size={24} /></div>
          <h1>SwachhLens</h1>
          <p>Civic waste intelligence & operations across India&apos;s municipalities.</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
        </div>

        {mode === 'signin' && (
          <div className="auth-demo-presets" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="demo-presets-label" style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-muted)' }}>
                ⚡ Quick Demo Profiles
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
              {DEMO_PRESETS.flatMap((g) => g.items).map((preset) => (
                <button
                  key={preset.email}
                  type="button"
                  className="demo-preset-btn"
                  onClick={() => handleDemoLogin(preset)}
                  disabled={busy}
                  style={{
                    padding: '8px 10px',
                    textAlign: 'left',
                    borderRadius: 8,
                    border: '1px solid var(--border-color, #e2e8f0)',
                    background: 'var(--bg-subtle, #f8fafc)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: preset.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: preset.color }}>{preset.badge}</span>
                  </div>
                  <strong style={{ fontSize: 12, color: 'var(--text-main, #0f172a)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {preset.label}
                  </strong>
                  <small style={{ fontSize: 10, color: 'var(--text-muted, #64748b)', fontFamily: 'monospace' }}>
                    {preset.email.split('@')[0]}
                  </small>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
              🔑 All demo accounts use password: <code style={{ color: 'var(--primary)', fontWeight: 600 }}>Swachh123!</code>
            </div>
          </div>
        )}

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <div className="auth-role" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              <button
                type="button"
                className={role === 'operator' ? 'active' : ''}
                onClick={() => setRole('operator')}
                style={{ padding: '10px 8px', textAlign: 'center' }}
              >
                <Icon name="LayoutDashboard" size={18} />
                <div style={{ fontWeight: 600, fontSize: 13 }}>Operator</div>
                <small style={{ fontSize: 10 }}>ULB Office</small>
              </button>
              <button
                type="button"
                className={role === 'worker' ? 'active' : ''}
                onClick={() => { setRole('worker'); detectLocation() }}
                style={{ padding: '10px 8px', textAlign: 'center' }}
              >
                <Icon name="HardHat" size={18} />
                <div style={{ fontWeight: 600, fontSize: 13 }}>Worker</div>
                <small style={{ fontSize: 10 }}>Field Squad</small>
              </button>
              <button
                type="button"
                className={role === 'superadmin' ? 'active' : ''}
                onClick={() => setRole('superadmin')}
                style={{ padding: '10px 8px', textAlign: 'center' }}
              >
                <Icon name="ShieldCheck" size={18} />
                <div style={{ fontWeight: 600, fontSize: 13 }}>Super Admin</div>
                <small style={{ fontSize: 10 }}>National View</small>
              </button>
            </div>
          )}

          {mode === 'signup' && (
            <div className="form-group">
              <label>Full name / Desk name</label>
              <input
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                placeholder={role === 'operator' ? 'e.g. BBMP Ward Officer' : role === 'superadmin' ? 'e.g. National Admin' : 'e.g. Kolkata Clean Squad'}
                required
              />
            </div>
          )}

          {mode === 'signup' && role !== 'superadmin' && municipalities.length > 0 && (
            <div className="form-group">
              <label>Assigned Municipality / ULB</label>
              <select
                value={form.municipality_id}
                onChange={(e) => update('municipality_id', e.target.value)}
                required
              >
                {municipalities.map((m) => (
                  <option key={m.id} value={m.id}>
                    🏛️ {m.name} ({m.city}, {m.state})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label>Email address</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="officer@city.gov.in or operator.bengaluru@swachhlens.local"
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              placeholder="Password (e.g. Swachh123!)"
              required
              minLength={6}
            />
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
              <div className="form-group" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  <Icon name="Navigation" size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {gps ? `GPS: ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : detectingGps ? 'Detecting current GPS location…' : 'GPS location will be auto-updated'}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={detectLocation} disabled={detectingGps}>
                  {detectingGps ? 'Locating…' : 'Refresh GPS'}
                </button>
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
