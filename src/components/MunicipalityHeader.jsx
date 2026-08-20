/**
 * MunicipalityHeader.jsx
 *
 * Branded municipality context bar shown in OperatorDashboard.
 * - For Super Admin: provides an interactive switcher between "All Municipalities (National Overview)"
 *   and individual municipalities.
 * - For regular Operators: locked to their assigned municipality with an authorized jurisdiction badge.
 */

import { useEffect, useState } from 'react'
import { api } from '../lib/api/index.js'
import { Icon } from './ui'

const MUNI_PALETTE = [
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#14b8a6', // teal
  '#ec4899', // pink
  '#22c55e', // green
  '#f97316', // orange
]

function muniColor(slug = '') {
  if (!slug || slug === 'all') return '#16a34a'
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) & 0xffff
  return MUNI_PALETTE[h % MUNI_PALETTE.length]
}

export default function MunicipalityHeader({
  municipalityId,
  onSelectMunicipality,
  reports = [],
  isSuperadmin = false,
}) {
  const [muniList, setMuniList] = useState([])
  const [currentMuni, setCurrentMuni] = useState(null)

  useEffect(() => {
    api
      .from('municipalities')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (data) setMuniList(data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!municipalityId || municipalityId === 'all') {
      setCurrentMuni(null)
      return
    }
    const found = muniList.find((m) => m.id === municipalityId)
    if (found) {
      setCurrentMuni(found)
    } else {
      api
        .from('municipalities')
        .select('*')
        .eq('id', municipalityId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setCurrentMuni(data)
        })
        .catch(() => {})
    }
  }, [municipalityId, muniList])

  const isNational = !municipalityId || municipalityId === 'all'
  const color = muniColor(currentMuni?.slug || (isNational ? 'all' : 'default'))
  const total = reports.length
  const active = reports.filter((r) => r.status !== 'Closed' && r.status !== 'Resolved').length
  const critical = reports.filter((r) => r.priority === 'Critical' && r.status !== 'Closed').length

  return (
    <div className="municipality-header" style={{ '--muni-color': color }}>
      {/* Left accent bar */}
      <div className="muni-accent-bar" style={{ background: color }} />

      <div className="muni-info">
        <div className="muni-name-row">
          <span className="muni-dot" style={{ background: color }} />

          {isSuperadmin && muniList.length > 0 && onSelectMunicipality ? (
            <div className="muni-switcher-wrap">
              <select
                className="muni-select"
                value={municipalityId || 'all'}
                onChange={(e) => onSelectMunicipality(e.target.value === 'all' ? null : e.target.value)}
              >
                <option value="all">🌐 All Municipalities (National Overview)</option>
                {muniList.map((m) => (
                  <option key={m.id} value={m.id}>
                    🏛️ {m.name} ({m.city}, {m.state})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="muni-name" style={{ fontWeight: 700, fontSize: 15 }}>
                🏛️ {currentMuni ? `${currentMuni.name} (${currentMuni.city})` : 'All Municipalities'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: 'rgba(22, 163, 74, 0.1)',
                  color: '#16a34a',
                  border: '1px solid rgba(22, 163, 74, 0.25)',
                }}
              >
                🔒 Scoped Jurisdiction
              </span>
            </div>
          )}

          {currentMuni && (
            <span className="muni-geo">
              {currentMuni.city} · {currentMuni.state}
            </span>
          )}
          {isNational && (
            <span className="muni-geo">India · National Overview</span>
          )}

          {isSuperadmin && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                background: '#f59e0b',
                color: '#fff',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              👑 Super Admin
            </span>
          )}
        </div>
        <div className="muni-sub">
          <Icon name="MapPin" size={11} />
          &nbsp;
          {isNational
            ? 'Aggregated cross-municipality operations and national metrics'
            : `Scoped exclusively to ${currentMuni?.name || 'assigned municipality'} jurisdiction`}
        </div>
      </div>

      <div className="muni-kpis">
        <div className="muni-kpi">
          <span className="muni-kpi-value">{total}</span>
          <span className="muni-kpi-label">Total</span>
        </div>
        <div className="muni-kpi">
          <span className="muni-kpi-value" style={{ color }}>
            {active}
          </span>
          <span className="muni-kpi-label">Active</span>
        </div>
        {critical > 0 && (
          <div className="muni-kpi">
            <span className="muni-kpi-value" style={{ color: '#ef4444' }}>
              {critical}
            </span>
            <span className="muni-kpi-label">Critical</span>
          </div>
        )}
      </div>

      <div className="muni-live">
        <span className="live-pill" style={{ borderColor: `${color}40` }}>
          <span className="live-dot" style={{ background: color }} />
          Live
        </span>
      </div>
    </div>
  )
}
