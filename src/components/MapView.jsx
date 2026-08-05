import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Icon } from '../components/ui'
import { statusColors, priorityColors, categoryColors } from '../lib/constants'

// Fix default marker icons in bundlers
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function makeIcon(color) {
  return L.divIcon({
    className: 'sl-map-pin',
    html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3)"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

function makeWorkerIcon() {
  return L.divIcon({
    className: 'sl-map-pin',
    html: `<span style="display:block;width:22px;height:22px;border-radius:50%;background:#16a34a;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35);font-size:12px;color:white;display:grid;place-items:center;font-weight:700">W</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

function Recenter({ center }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.flyTo(center, map.getZoom(), { duration: 0.5 })
  }, [center, map])
  return null
}

export default function MapView({
  reports = [],
  workers = [],
  center = [12.9716, 77.5946],
  zoom = 12,
  onMarkerClick,
  selectedId,
  height = 420,
  showWorkers = false,
}) {
  const validReports = reports.filter((r) => r.latitude != null && r.longitude != null)
  const validWorkers = showWorkers ? workers.filter((w) => w.latitude != null && w.longitude != null) : []
  const flyCenter = selectedId
    ? (() => {
        const r = reports.find((x) => x.id === selectedId)
        return r && r.latitude != null ? [r.latitude, r.longitude] : null
      })()
    : null

  return (
    <div style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />
        <Recenter center={flyCenter} />
        {validReports.map((r) => {
          const color = r.approval_status === 'Pending' ? '#f59e0b' : statusColors[r.status] || '#0ea5e9'
          return (
            <Marker
              key={r.id}
              position={[r.latitude, r.longitude]}
              icon={makeIcon(color)}
              eventHandlers={{ click: () => onMarkerClick && onMarkerClick(r) }}
            >
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <strong>{r.reference_code}</strong>
                  <div style={{ margin: '4px 0', fontSize: 13 }}>{r.category}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{r.location}</div>
                  <div style={{ marginTop: 6 }}>
                    <span style={{ background: priorityColors[r.priority], color: 'white', padding: '2px 8px', borderRadius: 999, fontSize: 11 }}>
                      {r.priority}
                    </span>{' '}
                    <span style={{ background: color, color: 'white', padding: '2px 8px', borderRadius: 999, fontSize: 11 }}>
                      {r.approval_status === 'Pending' ? 'Pending' : r.status}
                    </span>
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        })}
        {validWorkers.map((w) => (
          <Marker key={w.id} position={[w.latitude, w.longitude]} icon={makeWorkerIcon()}>
            <Popup>
              <div>
                <strong>{w.full_name}</strong>
                <div style={{ fontSize: 12, color: '#64748b' }}>{w.zone} zone · {w.is_available ? 'Available' : 'Busy'}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
