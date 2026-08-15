import { useEffect, useRef, useState, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Icon } from './ui'

// ─── Custom Map Icons ─────────────────────────────────────────────────────────
function makeWorkerIcon(heading = 0) {
  return L.divIcon({
    className: '',
    html: `
      <div class="nav-worker-marker" style="transform: rotate(${heading}deg)">
        <svg width="38" height="38" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="19" cy="19" r="18" fill="#16a34a" stroke="white" stroke-width="2.5"/>
          <circle cx="19" cy="19" r="10" fill="white" opacity="0.25"/>
          <!-- Arrow pointing up (north) -->
          <path d="M19 9 L24 22 L19 19 L14 22 Z" fill="white"/>
        </svg>
        <div class="nav-worker-pulse"></div>
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
}

function makeDestinationIcon() {
  return L.divIcon({
    className: '',
    html: `
      <div class="nav-dest-marker">
        <div class="nav-dest-pin">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#ef4444"/>
            <circle cx="12" cy="9" r="3" fill="white"/>
          </svg>
        </div>
        <div class="nav-dest-pulse"></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  })
}

// ─── Map Controller (fit bounds to route) ────────────────────────────────────
function MapController({ routePoints, workerPos, destPos, following }) {
  const map = useMap()
  const hasFitted = useRef(false)

  useEffect(() => {
    if (routePoints && routePoints.length > 1 && !hasFitted.current) {
      const bounds = L.latLngBounds(routePoints.map(([lat, lng]) => [lat, lng]))
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 })
      hasFitted.current = true
    }
  }, [routePoints, map])

  useEffect(() => {
    if (following && workerPos) {
      map.panTo(workerPos, { animate: true, duration: 0.8 })
    }
  }, [workerPos, following, map])

  return null
}

// ─── OSRM Route Fetcher ───────────────────────────────────────────────────────
async function fetchRoute(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=false`
    const res = await fetch(url)
    const data = await res.json()
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0]
      const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
      const distanceKm = (route.distance / 1000).toFixed(1)
      const durationMin = Math.ceil(route.duration / 60)
      return { coords, distanceKm, durationMin }
    }
  } catch {
    // Fall back to straight line
  }
  // Fallback: straight line
  return {
    coords: [from, to],
    distanceKm: haversineKm(from, to).toFixed(1),
    durationMin: Math.ceil(haversineKm(from, to) / 0.5), // ~30kmh
  }
}

function haversineKm([lat1, lon1], [lat2, lon2]) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Compute heading between two points ──────────────────────────────────────
function computeHeading([lat1, lon1], [lat2, lon2]) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180)
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// ─── Status Step Timeline ─────────────────────────────────────────────────────
function StatusSteps({ status }) {
  const steps = ['Assigned', 'En route', 'On site', 'Completed']
  const idx = steps.indexOf(status)
  return (
    <div className="nav-steps">
      {steps.map((s, i) => (
        <div key={s} className={`nav-step ${i <= idx ? 'done' : ''} ${i === idx ? 'active' : ''}`}>
          <div className="nav-step-dot" />
          {i < steps.length - 1 && <div className="nav-step-line" />}
          <span className="nav-step-label">{s}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main Navigation Modal ───────────────────────────────────────────────────
export default function WorkerNavigationModal({ task, workerProfile, onClose, onArrivedOnSite }) {
  const report = task?.report

  // Destination coords
  const destLat = report?.latitude || task?.latitude
  const destLng = report?.longitude || task?.longitude

  // Worker position state
  const [workerPos, setWorkerPos] = useState(
    workerProfile?.latitude && workerProfile?.longitude
      ? [workerProfile.latitude, workerProfile.longitude]
      : null
  )

  const [heading, setHeading] = useState(0)
  const [routeCoords, setRouteCoords] = useState([])
  const [distanceKm, setDistanceKm] = useState(null)
  const [etaMin, setEtaMin] = useState(null)
  const [routeLoading, setRouteLoading] = useState(true)
  const [following, setFollowing] = useState(true)
  const [simulating, setSimulating] = useState(false)
  const [arrived, setArrived] = useState(false)

  const simRef = useRef(null)
  const simIndexRef = useRef(0)
  const watchRef = useRef(null)

  const destPos = destLat && destLng ? [destLat, destLng] : null

  // ─── Load route ──────────────────────────────────────────────────────────
  const loadRoute = useCallback(async (from) => {
    if (!destPos || !from) return
    setRouteLoading(true)
    const result = await fetchRoute(from, destPos)
    setRouteCoords(result.coords)
    setDistanceKm(result.distanceKm)
    setEtaMin(result.durationMin)
    setRouteLoading(false)
  }, [destPos]) // eslint-disable-line

  // ─── Start GPS watch ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const newPos = [pos.coords.latitude, pos.coords.longitude]
        setWorkerPos((prev) => {
          if (prev) {
            setHeading(computeHeading(prev, newPos))
          }
          return newPos
        })
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current)
    }
  }, [])

  // ─── Fetch route once we have worker position ─────────────────────────────
  useEffect(() => {
    if (workerPos) {
      loadRoute(workerPos)
    }
  }, []) // eslint-disable-line

  // ─── Live distance recalc ────────────────────────────────────────────────
  useEffect(() => {
    if (workerPos && destPos) {
      const km = haversineKm(workerPos, destPos)
      setDistanceKm(km.toFixed(1))
      setEtaMin(Math.max(1, Math.ceil((km / 30) * 60)))
      if (km < 0.05) setArrived(true)
    }
  }, [workerPos]) // eslint-disable-line

  // ─── Simulation along route ──────────────────────────────────────────────
  function startSimulation() {
    if (simRef.current) clearInterval(simRef.current)
    simIndexRef.current = 0
    setSimulating(true)
    if (routeCoords.length < 2) return
    simRef.current = setInterval(() => {
      const i = simIndexRef.current
      if (i >= routeCoords.length - 1) {
        clearInterval(simRef.current)
        setSimulating(false)
        setArrived(true)
        return
      }
      const curr = routeCoords[i]
      const next = routeCoords[i + 1]
      setHeading(computeHeading(curr, next))
      setWorkerPos(curr)
      simIndexRef.current = i + 1
    }, 300)
  }

  function stopSimulation() {
    if (simRef.current) clearInterval(simRef.current)
    setSimulating(false)
  }

  useEffect(() => () => stopSimulation(), [])

  // ─── Open in Google Maps ─────────────────────────────────────────────────
  function openGoogleMaps() {
    if (!destPos) return
    const url = `https://www.google.com/maps/dir/?api=1&destination=${destPos[0]},${destPos[1]}&travelmode=driving`
    window.open(url, '_blank')
  }

  // ─── Handle Arrived ──────────────────────────────────────────────────────
  function handleArrived() {
    stopSimulation()
    onArrivedOnSite()
  }

  const hasLocation = workerPos && destPos

  return (
    <div className="nav-modal-overlay">
      <div className="nav-modal">
        {/* ── Header ── */}
        <div className="nav-modal-header">
          <div className="nav-header-left">
            <div className="nav-header-icon">
              <Icon name="Navigation" size={20} />
            </div>
            <div>
              <div className="nav-header-title">Live Navigation</div>
              <div className="nav-header-sub">{report?.location || 'En route to site'}</div>
            </div>
          </div>
          <button className="nav-close-btn" onClick={onClose}>
            <Icon name="X" size={20} />
          </button>
        </div>

        {/* ── Status Steps ── */}
        <StatusSteps status={task?.status || 'En route'} />

        {/* ── ETA / Distance Card ── */}
        <div className="nav-eta-card">
          <div className="nav-eta-item">
            <div className="nav-eta-value">
              {routeLoading ? '–' : distanceKm !== null ? `${distanceKm} km` : '–'}
            </div>
            <div className="nav-eta-label">Distance</div>
          </div>
          <div className="nav-eta-divider" />
          <div className="nav-eta-item nav-eta-center">
            <div className="nav-eta-value primary">
              {routeLoading ? '–' : etaMin !== null ? `~${etaMin} min` : '–'}
            </div>
            <div className="nav-eta-label">ETA</div>
          </div>
          <div className="nav-eta-divider" />
          <div className="nav-eta-item">
            <div className="nav-eta-value">{report?.priority || '–'}</div>
            <div className="nav-eta-label">Priority</div>
          </div>
        </div>

        {/* ── Map ── */}
        <div className="nav-map-wrap">
          {!hasLocation ? (
            <div className="nav-map-placeholder">
              <div className="nav-map-placeholder-content">
                <div className="nav-spinner" />
                <p>Acquiring GPS signal…</p>
                <p className="nav-no-gps-hint">
                  Enable location permissions or use the Simulate button below to demo navigation.
                </p>
                {destPos && (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      // Offset slightly from destination for demo
                      const demoStart = [destPos[0] - 0.012, destPos[1] - 0.018]
                      setWorkerPos(demoStart)
                      loadRoute(demoStart)
                    }}
                  >
                    <Icon name="Play" size={14} /> Use Demo Location
                  </button>
                )}
              </div>
            </div>
          ) : (
            <MapContainer
              center={workerPos}
              zoom={15}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
              />
              <MapController
                routePoints={routeCoords}
                workerPos={workerPos}
                destPos={destPos}
                following={following}
              />

              {/* Route polyline */}
              {routeCoords.length > 1 && (
                <>
                  {/* Shadow / casing */}
                  <Polyline
                    positions={routeCoords}
                    pathOptions={{ color: '#0284c7', weight: 10, opacity: 0.3 }}
                  />
                  {/* Main route */}
                  <Polyline
                    positions={routeCoords}
                    pathOptions={{ color: '#0ea5e9', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }}
                  />
                </>
              )}

              {/* Worker marker */}
              {workerPos && (
                <Marker position={workerPos} icon={makeWorkerIcon(heading)} />
              )}

              {/* Destination marker */}
              {destPos && (
                <Marker position={destPos} icon={makeDestinationIcon()} />
              )}
            </MapContainer>
          )}

          {/* Follow / Unfollow toggle */}
          {hasLocation && (
            <button
              className={`nav-follow-btn ${following ? 'active' : ''}`}
              onClick={() => setFollowing((f) => !f)}
              title={following ? 'Following your location' : 'Click to re-center'}
            >
              <Icon name={following ? 'Crosshair' : 'Navigation'} size={18} />
            </button>
          )}

          {/* Route loading spinner */}
          {routeLoading && hasLocation && (
            <div className="nav-route-loading">
              <div className="nav-spinner-sm" />
              <span>Calculating route…</span>
            </div>
          )}
        </div>

        {/* ── Destination Info ── */}
        <div className="nav-dest-info">
          <div className="nav-dest-icon-wrap">
            <Icon name="MapPin" size={16} />
          </div>
          <div>
            <div className="nav-dest-address">{report?.location || 'Task site'}</div>
            <div className="nav-dest-cat">{report?.category} — Task #{task?.task_code}</div>
          </div>
        </div>

        {/* ── Arrived Banner ── */}
        {arrived && (
          <div className="nav-arrived-banner">
            <Icon name="CheckCircle2" size={18} />
            <span>You are near the site! Mark yourself as On Site to begin cleanup.</span>
          </div>
        )}

        {/* ── Footer Actions ── */}
        <div className="nav-modal-footer">
          <button className="btn btn-ghost" onClick={openGoogleMaps}>
            <Icon name="ExternalLink" size={15} /> Google Maps
          </button>

          {!simulating ? (
            <button
              className="btn btn-ghost nav-sim-btn"
              onClick={startSimulation}
              disabled={routeLoading || routeCoords.length < 2}
            >
              <Icon name="Play" size={15} /> Simulate Drive
            </button>
          ) : (
            <button className="btn btn-ghost nav-sim-btn" onClick={stopSimulation}>
              <Icon name="Square" size={15} /> Stop Sim
            </button>
          )}

          <button className="btn btn-success nav-arrive-btn" onClick={handleArrived}>
            <Icon name="MapPin" size={16} /> Arrived On Site
          </button>
        </div>
      </div>
    </div>
  )
}
