import { useEffect, useState } from 'react'
import { api, STATUS_FLOW, generateTaskCode } from '../lib/api/index.js'
import { useAuth } from '../lib/auth'
import { findNearestWorker, haversineKm } from '../lib/ai'
import { Badge, Icon } from './ui'
import MapView from './MapView'
import { statusColors, priorityColors, formatDate, formatRelativeTime, getSlaStatus, categoryColors } from '../lib/constants'

export default function ReportDrawer({ report, onClose, onChanged, toast }) {
  const { profile } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [workers, setWorkers] = useState([])
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    if (!report) return
    setLoadingTasks(true)
    api
      .from('swachhlens_tasks')
      .select('*, worker:profiles(*)')
      .eq('report_id', report.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setTasks(data || [])
        setLoadingTasks(false)
      })
    api
      .from('profiles')
      .select('*')
      .eq('role', 'worker')
      .then(({ data }) => setWorkers(data || []))
  }, [report])

  if (!report) return null

  const sla = getSlaStatus(report)
  const ai = report.ai_analysis

  async function updateReport(patch, message) {
    const { data, error } = await api
      .from('swachhlens_reports')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', report.id)
      .select()
      .single()
    if (error) { toast('Could not update the report.', 'error'); return }
    onChanged(data)
    if (message) toast(message, 'success')
  }

  async function approveReport() {
    await updateReport(
      { approval_status: 'Approved', status: 'Verified', citizen_update: 'Report approved. Assigning nearest crew.' },
      'Report approved.',
    )
  }

  async function rejectReport() {
    await updateReport(
      { approval_status: 'Rejected', status: 'Closed', citizen_update: 'Report could not be verified and has been closed.' },
      'Report rejected.',
    )
  }

  async function autoAssignWorker() {
    if (!report.latitude || !report.longitude) {
      toast('Report has no GPS coordinates — assign manually.', 'error')
      return
    }
    const worker = findNearestWorker(workers, report.latitude, report.longitude)
    if (!worker) {
      toast('No available workers with GPS location.', 'error')
      return
    }
    setAssigning(true)
    const distKm = haversineKm(report.latitude, report.longitude, worker.latitude, worker.longitude)
    const eta = `${Math.max(10, Math.round(distKm * 4))} min`
    const { data: task, error } = await api
      .from('swachhlens_tasks')
      .insert({
        report_id: report.id,
        task_code: generateTaskCode(),
        crew_name: worker.full_name,
        vehicle: 'Auto-assigned',
        eta,
        status: 'Assigned',
        scheduled_for: new Date(Date.now() + 30 * 60000).toISOString(),
        latitude: report.latitude,
        longitude: report.longitude,
        worker_id: worker.id,
      })
      .select()
      .single()
    setAssigning(false)
    if (error) { toast('Could not assign worker.', 'error'); return }

    await updateReport({
      status: 'Assigned',
      assigned_worker_id: worker.id,
      citizen_update: `Crew ${worker.full_name} assigned and notified. ETA ${eta}.`,
    }, `${worker.full_name} assigned (${distKm.toFixed(1)} km away).`)

    setTasks((t) => [task, ...t])
  }

  async function advanceStatus() {
    const idx = STATUS_FLOW.indexOf(report.status)
    if (idx >= STATUS_FLOW.length - 1) return
    const next = STATUS_FLOW[idx + 1]
    const updates = {
      Verified: 'Report verified by the operations desk and prioritised.',
      Assigned: 'Cleanup crew assigned and dispatched.',
      'In Progress': 'Crew is on site and cleanup is underway.',
      Resolved: 'Site cleaned. Awaiting resident confirmation.',
      Closed: 'Report closed. Thank you for helping keep the city clean.',
    }
    await updateReport({ status: next, citizen_update: updates[next] || report.citizen_update }, `Report moved to ${next}.`)
  }

  async function verifyClose() {
    await updateReport(
      { status: 'Closed', approval_status: 'Approved', citizen_update: 'Report verified and closed. Thank you for helping keep the city clean.' },
      'Report verified and closed.',
    )
    if (tasks[0]) {
      await api.from('swachhlens_tasks').update({ status: 'Verified', updated_at: new Date().toISOString() }).eq('id', tasks[0].id)
      setTasks((t) => t.map((x) => (x.id === tasks[0].id ? { ...x, status: 'Verified' } : x)))
    }
  }

  async function escalate() {
    if (!tasks[0]) return
    await api.from('swachhlens_tasks').update({ escalated: true, updated_at: new Date().toISOString() }).eq('id', tasks[0].id)
    setTasks((t) => t.map((x) => (x.id === tasks[0].id ? { ...x, escalated: true } : x)))
    toast('Task escalated to zone supervisor.', 'success')
  }

  const canApprove = report.approval_status === 'Pending'
  const canAutoAssign = report.approval_status === 'Approved' || report.approval_status === 'Auto-approved'
  const canAdvance = report.status !== 'Closed'
  const canVerify = report.status === 'Resolved'

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <span className="ref-code">{report.reference_code}</span>
              <Badge color={statusColors[report.status]}>{report.status}</Badge>
              <Badge color={priorityColors[report.priority]}>{report.priority}</Badge>
              {report.approval_status === 'Pending' && <span className="tag tag-hazard"><Icon name="Clock" size={11} /> Pending approval</span>}
              {report.approval_status === 'Auto-approved' && <span className="tag" style={{ background: 'var(--success-soft)', color: 'var(--accent)' }}><Icon name="Zap" size={11} /> Auto-approved</span>}
              {report.approval_status === 'Approved' && <span className="tag" style={{ background: 'var(--success-soft)', color: 'var(--accent)' }}><Icon name="Check" size={11} /> Approved</span>}
            </div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{report.category}</h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{report.location} · {report.zone} zone</p>
          </div>
          <button className="drawer-close" onClick={onClose}><Icon name="X" size={20} /></button>
        </div>

        <div className="drawer-body">
          {report.latitude && report.longitude && (
            <div className="detail-section">
              <div className="detail-label">Site location</div>
              <MapView reports={[report]} center={[report.latitude, report.longitude]} zoom={16} height={220} selectedId={report.id} />
            </div>
          )}

          {ai && (
            <div className="detail-section">
              <div className="detail-label">AI triage analysis</div>
              <div className="ai-result-card">
                <div className="ai-row"><span className="muted">Detected category</span><strong>{ai.category}</strong></div>
                <div className="ai-row"><span className="muted">Volume</span><strong>{ai.volume}</strong></div>
                <div className="ai-row"><span className="muted">Severity</span><strong>{ai.severity_score}/100</strong></div>
                <div className="ai-row"><span className="muted">Recommended team</span><strong>{ai.team_size}</strong></div>
                <div className="ai-row"><span className="muted">Confidence</span><strong>{ai.confidence}%</strong></div>
                <div className="ai-row"><span className="muted">Hazard</span><strong>{ai.hazard ? 'Yes' : 'No'}</strong></div>
                <p className="ai-summary">{ai.summary}</p>
              </div>
            </div>
          )}

          <div className="detail-section">
            <div className="detail-label">Report summary</div>
            <div className="detail-grid">
              <div className="detail-field"><strong>Reported</strong><span>{formatRelativeTime(report.reported_at)}</span></div>
              <div className="detail-field"><strong>Reporter</strong><span>{report.resident_name}</span></div>
              <div className="detail-field"><strong>Phone</strong><span>{report.citizen_phone || '—'}</span></div>
              <div className="detail-field"><strong>Duplicates</strong><span>{report.duplicate_count}</span></div>
            </div>
            {report.description && <p style={{ fontSize: 14, marginTop: 12, lineHeight: 1.6 }}>{report.description}</p>}
            {report.image_url && <div className="image-placeholder" style={{ marginTop: 12 }}><img src={report.image_url} alt="Evidence" /></div>}
          </div>

          <div className="detail-section">
            <div className="detail-label">SLA</div>
            <div className="sla-cell" style={{ maxWidth: 280 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="sla-label" style={{ color: sla.color }}>{sla.label}</span>
                <span className="muted" style={{ fontSize: 12 }}>{Math.round(sla.percent)}%</span>
              </div>
              <div className="sla-bar"><div className="sla-fill" style={{ width: `${sla.percent}%`, background: sla.color }} /></div>
            </div>
          </div>

          <div className="detail-section">
            <div className="detail-label">Cleanup tasks</div>
            {loadingTasks ? (
              <div className="muted">Loading…</div>
            ) : tasks.length === 0 ? (
              <div className="empty-tasks">
                <p className="muted">No crew assigned yet.</p>
                {canAutoAssign && (
                  <button className="btn btn-primary btn-sm" onClick={autoAssignWorker} disabled={assigning}>
                    <Icon name="Zap" size={14} /> {assigning ? 'Finding nearest worker…' : 'Auto-assign nearest worker'}
                  </button>
                )}
                {!canAutoAssign && canApprove && <p className="muted" style={{ fontSize: 12 }}>Approve the report first to enable assignment.</p>}
              </div>
            ) : (
              tasks.map((task) => (
                <div key={task.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span className="ref-code">{task.task_code}</span>
                    <Badge color={statusColors[task.status] || '#64748b'}>{task.status}</Badge>
                  </div>
                  <div className="detail-grid">
                    <div className="detail-field"><strong>Crew</strong><span>{task.crew_name}</span></div>
                    <div className="detail-field"><strong>Vehicle</strong><span>{task.vehicle}</span></div>
                    <div className="detail-field"><strong>ETA</strong><span>{task.eta}</span></div>
                    <div className="detail-field"><strong>Scheduled</strong><span>{formatDate(task.scheduled_for)}</span></div>
                    {task.ai_rating != null && <div className="detail-field"><strong>AI rating</strong><span style={{ color: task.ai_rating >= 80 ? '#16a34a' : '#f59e0b' }}>{task.ai_rating}/100</span></div>}
                  </div>
                  {task.worker_note && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>{task.worker_note}</p>}
                  {task.after_image_url && <div className="image-placeholder" style={{ marginTop: 8 }}><img src={task.after_image_url} alt="After" /></div>}
                  {task.escalated && <div className="tag tag-hazard" style={{ marginTop: 8 }}><Icon name="AlertTriangle" size={12} /> Escalated</div>}
                  {task.status === 'Assigned' && !task.escalated && (
                    <button className="btn btn-danger-ghost btn-sm" style={{ marginTop: 10 }} onClick={escalate}><Icon name="AlertTriangle" size={14} /> Escalate</button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="detail-section">
            <div className="detail-label">Resident update</div>
            <div style={{ background: 'var(--surface-muted)', borderRadius: 10, padding: 14, fontSize: 14 }}>{report.citizen_update}</div>
          </div>
        </div>

        <div className="drawer-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {canApprove && (
            <>
              <button className="btn btn-danger-ghost" onClick={rejectReport}><Icon name="X" size={16} /> Reject</button>
              <button className="btn btn-success" onClick={approveReport}><Icon name="Check" size={16} /> Approve</button>
            </>
          )}
          {canAutoAssign && tasks.length === 0 && (
            <button className="btn btn-primary" onClick={autoAssignWorker} disabled={assigning}>
              <Icon name="Zap" size={16} /> {assigning ? 'Assigning…' : 'Auto-assign worker'}
            </button>
          )}
          {canAdvance && !canVerify && canApprove === false && tasks.length > 0 && (
            <button className="btn btn-primary" onClick={advanceStatus}>
              <Icon name="ArrowRightCircle" size={16} /> Advance to {STATUS_FLOW[STATUS_FLOW.indexOf(report.status) + 1]}
            </button>
          )}
          {canVerify && (
            <button className="btn btn-success" onClick={verifyClose}><Icon name="ShieldCheck" size={16} /> Verify &amp; close</button>
          )}
        </div>
      </div>
    </>
  )
}
