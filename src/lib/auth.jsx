import { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api/index.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id)
      else setLoading(false)
    })

    const { data: sub } = api.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession) {
        ;(async () => loadProfile(newSession.user.id))()
      } else {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    const { data } = await api.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(data)
    setLoading(false)
  }

  async function ensureProfile(user, role, extra = {}) {
    const { data: existing } = await api.from('profiles').select('id').eq('id', user.id).maybeSingle()
    if (existing) {
      await loadProfile(user.id)
      return
    }
    const row = {
      id: user.id,
      role,
      full_name: extra.full_name || user.email?.split('@')[0] || 'Team member',
      phone: extra.phone || '',
      zone: extra.zone || 'Central',
    }
    const { data } = await api.from('profiles').insert(row).select().single()
    setProfile(data)
  }

  async function signUp({ email, password, role, full_name, phone, zone }) {
    const { data, error } = await api.auth.signUp({ email, password, role, full_name, phone, zone })
    if (error) return { error }
    if (data?.user) {
      if (data.profile) {
        setSession(data.session || { user: data.user })
        setProfile(data.profile)
      } else {
        await ensureProfile(data.user, role, { full_name, phone, zone })
      }
    }
    return { error: null }
  }

  async function signIn({ email, password }) {
    const { data, error } = await api.auth.signInWithPassword({ email, password })
    if (error) return { error }
    if (data?.user) {
      setSession(data.session)
      if (data.profile) {
        setProfile(data.profile)
      } else {
        await loadProfile(data.user.id)
      }
    }
    return { error: null }
  }

  async function signOut() {
    await api.auth.signOut()
    setSession(null)
    setProfile(null)
  }

  const value = { session, profile, loading, signIn, signUp, signOut, ensureProfile }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
