/**
 * MunicipalityHeader.jsx
 *
 * A branded municipality context bar shown inside the OperatorDashboard.
 * Fetches the municipality record matching the active municipality_id
 * and renders:
 *   - Municipality name + city / state chip
 *   - A dropdown switcher to inspect other Urban Local Bodies (e.g. BBMP, BMC, PMC, or All)
 *   - A coloured accent bar unique to each municipality
 *   - Live connection badge
 *   - Compact KPI summary (total, active, critical)
 */

import { useEffect, useState } from 'react'
import { api } from '../lib/api/index.js'
import { Icon } from './ui'

const MUNI_PALETTE = [
  '#6366f1', // indigo   — default
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
          
          {muniList.length > 0 && onSelectMunicipality ? (
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
            <span className="muni-name">
              {currentMuni ? `${currentMuni.name} (${currentMuni.city})` : 'All Municipalities'}
            </span>
          )}

          {currentMuni && (
            <span className="muni-geo">
              {currentMuni.city} · {currentMuni.state}
            </span>
          )}
          {isNational && (
            <span className="muni-geo">India · National</span>
          )}
        </div>
        <div className="muni-sub">
          <Icon name="MapPin" size={11} />
          &nbsp;{isNational ? 'Aggregated cross-municipality view' : `Scoped operations for ${currentMuni?.name || 'municipality'}`}
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
