import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { Icon } from './ui'
import { ZONES } from '../lib/api/index.js'

export default function AuthScreen({ onCitizen }) {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin')
  const [role, setRole] = useState('operator')
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone: '', zone: 'Central' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    if (mode === 'signin') {
      const { error } = await signIn({ email: form.email, password: form.password })
      if (error) setError(error.message.includes('Invalid login') ? 'Incorrect email or password.' : error.message)
    } else {
      if (!form.full_name.trim()) {
        setError('Please enter your name.')
        setBusy(false)
        return
      }
      const { error } = await signUp({ ...form, role })
      if (error) setError(error.message.includes('already') ? 'An account with this email already exists.' : error.message)
      else setError('Check your email — but since confirmation is off, try signing in now.')
    }
    setBusy(false)
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark"><Icon name="Leaf" size={24} /></div>
          <h1>SwachhLens</h1>
          <p>Civic waste operations — operators, workers & citizens on one platform.</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <div className="auth-role">
              <button type="button" className={role === 'operator' ? 'active' : ''} onClick={() => setRole('operator')}>
                <Icon name="LayoutDashboard" size={18} /> Operator
                <small>Municipality / NGO dashboard</small>
              </button>
              <button type="button" className={role === 'worker' ? 'active' : ''} onClick={() => setRole('worker')}>
                <Icon name="HardHat" size={18} /> Worker
                <small>Field cleanup crew</small>
              </button>
            </div>
          )}

          {mode === 'signup' && (
            <div className="form-group">
              <label>Full name</label>
              <input value={form.full_name} onChange={(e) => update('full_name', e.target.value)} placeholder="Your name" />
            </div>
          )}

          <div className="form-group">
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="you@city.gov" required />
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
