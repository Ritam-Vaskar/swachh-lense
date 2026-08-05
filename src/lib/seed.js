import { api, generateReferenceCode, generateTaskCode } from './api/index.js'
import { analyzeReport } from './ai'

const seedReports = [
  {
    category: 'Overflowing bin',
    location: 'MG Road, near Metro Station Gate 2',
    zone: 'Central',
    volume: 'Overflowing',
    hazard_flag: true,
    description: 'Bin has not been cleared in four days. Waste spilling onto the road and pedestrians are walking around it.',
    resident_name: 'Anita Rao',
    duplicate_count: 3,
    latitude: 12.9756,
    longitude: 77.6050,
  },
  {
    category: 'Illegal dumpsite',
    location: 'Sector 14, behind the wholesale market',
    zone: 'West',
    volume: 'Large',
    hazard_flag: false,
    description: 'Construction debris and packaging dumped on empty plot overnight.',
    resident_name: 'Mohan Iyer',
    duplicate_count: 1,
    latitude: 12.9620,
    longitude: 77.5480,
  },
  {
    category: 'Blocked drain',
    location: 'Lake View Road, opposite Park entrance',
    zone: 'Riverside',
    volume: 'Medium',
    hazard_flag: true,
    description: 'Drain blocked with plastic and leaves. Water backing up into the street after light rain.',
    resident_name: 'Priya Nair',
    duplicate_count: 2,
    latitude: 12.9420,
    longitude: 77.5780,
  },
  {
    category: 'Street litter',
    location: 'Indiranagar 100ft Road, near bus stop',
    zone: 'East',
    volume: 'Small',
    hazard_flag: false,
    description: 'Food wrappers and cups around the bus stop after the weekend market.',
    resident_name: 'Rahul Das',
    duplicate_count: 1,
    latitude: 12.9719,
    longitude: 77.6412,
  },
  {
    category: 'Medical waste',
    location: 'City Hospital back gate, 4th Cross',
    zone: 'North',
    volume: 'Small',
    hazard_flag: true,
    description: 'Used syringes and gloves spotted near the hospital waste collection point.',
    resident_name: 'Dr. Kavya Menon',
    duplicate_count: 1,
    latitude: 13.0120,
    longitude: 77.5650,
  },
  {
    category: 'Public toilet issue',
    location: 'Central Bus Stand, Platform 4 exit',
    zone: 'Central',
    volume: 'Medium',
    hazard_flag: false,
    description: 'Public toilet not cleaned today and water supply is cut off.',
    resident_name: 'Suresh Pillai',
    duplicate_count: 4,
    latitude: 12.9900,
    longitude: 77.5700,
  },
]

const sampleTasks = [
  { crew_name: 'Green Squad A', vehicle: 'Tipper T-12', eta: '25 min' },
  { crew_name: 'River Crew B', vehicle: 'Sweeper S-07', eta: '40 min' },
]

const demoAccounts = [
  {
    email: 'operator@swachhlens.local',
    password: 'Swachh123!',
    role: 'operator',
    full_name: 'Demo Operator',
    phone: '',
    zone: 'Central',
  },
  {
    email: 'green@squad.local',
    password: 'Swachh123!',
    role: 'worker',
    full_name: 'Green Squad A',
    phone: '+91 90000 10001',
    zone: 'Central',
    latitude: 12.9783,
    longitude: 77.5921,
  },
  {
    email: 'river@crew.local',
    password: 'Swachh123!',
    role: 'worker',
    full_name: 'River Crew B',
    phone: '+91 90000 10002',
    zone: 'Riverside',
    latitude: 12.9442,
    longitude: 77.5808,
  },
]

export async function seedDemoData() {
  const { count } = await api.from('swachhlens_reports').select('*', { count: 'exact', head: true })
  if (count && count > 0) return false

  const seededProfiles = {}
  for (const account of demoAccounts) {
    const { data: authData } = await api.auth.ensureUser({
      email: account.email,
      password: account.password,
      role: account.role,
      full_name: account.full_name,
      phone: account.phone,
      zone: account.zone,
      latitude: account.latitude,
      longitude: account.longitude,
      is_available: true,
    })
    const profileCheck = await api.from('profiles').select('id').eq('id', authData.user.id).maybeSingle()
    if (!profileCheck.data) {
      const { data: profile } = await api.from('profiles').insert({
        id: authData.user.id,
        role: account.role,
        full_name: account.full_name,
        phone: account.phone || '',
        zone: account.zone || 'Central',
        latitude: account.latitude,
        longitude: account.longitude,
        is_available: true,
      }).select().single()
      if (profile?.id) seededProfiles[account.full_name] = profile
    } else {
      seededProfiles[account.full_name] = { id: authData.user.id }
    }
  }

  for (let i = 0; i < seedReports.length; i++) {
    const s = seedReports[i]
    const ai = analyzeReport({ description: s.description, category: s.category, hazard_flag: s.hazard_flag })
    const severity = ai.severity_score
    const priority = ai.priority
    const status = i < 2 ? 'Assigned' : 'New'
    const approval = i < 2 ? 'Approved' : ai.autoApproved ? 'Auto-approved' : 'Pending'
    const reportRow = {
      reference_code: generateReferenceCode(),
      category: s.category,
      location: s.location,
      zone: s.zone,
      latitude: s.latitude,
      longitude: s.longitude,
      volume: s.volume,
      severity_score: severity,
      priority,
      hazard_flag: s.hazard_flag,
      description: s.description,
      resident_name: s.resident_name,
      duplicate_count: s.duplicate_count,
      confidence: ai.confidence,
      team_size: ai.team_size,
      ai_analysis: ai,
      status,
      approval_status: approval,
      assigned_worker_id: i < 2 ? (i === 0 ? seededProfiles['Green Squad A']?.id : seededProfiles['River Crew B']?.id) : null,
      citizen_update: status === 'Assigned' ? 'Crew dispatched and on the way.' : approval === 'Auto-approved' ? 'Report auto-approved and queued for worker assignment.' : 'Report received and awaiting operator review.',
    }
    const { data } = await api.from('swachhlens_reports').insert(reportRow).select().single()

    if (i < 2 && data) {
      const task = sampleTasks[i]
      const scheduled = new Date(Date.now() + (i === 0 ? 15 : 45) * 60000).toISOString()
      await api.from('swachhlens_tasks').insert({
        report_id: data.id,
        task_code: generateTaskCode(),
        crew_name: task.crew_name,
        vehicle: task.vehicle,
        eta: task.eta,
        status: 'Assigned',
        scheduled_for: scheduled,
        latitude: data.latitude,
        longitude: data.longitude,
        worker_id: i === 0 ? seededProfiles['Green Squad A']?.id : seededProfiles['River Crew B']?.id,
      })
    }
  }
  return true
}
