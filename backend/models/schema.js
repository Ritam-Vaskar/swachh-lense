import crypto from 'node:crypto'

export const DEMO_ACCOUNTS = [
  { email: 'operator@swachhlens.local', password: 'Swachh123!', role: 'operator', full_name: 'Demo Operator', phone: '+91 90000 00001', zone: 'Central' },
  
  // Kolkata Worker Groups (4 distinct GPS locations)
  { email: 'kolkata.saltlake@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Kolkata Squad - Salt Lake', phone: '+91 98300 20001', zone: 'East', latitude: 22.5804, longitude: 88.4378 },
  { email: 'kolkata.parkstreet@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Kolkata Squad - Park Street', phone: '+91 98300 20002', zone: 'Central', latitude: 22.5518, longitude: 88.3524 },
  { email: 'kolkata.newtown@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Kolkata Squad - New Town', phone: '+91 98300 20003', zone: 'North', latitude: 22.5937, longitude: 88.4720 },
  { email: 'kolkata.gariahat@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Kolkata Squad - Gariahat', phone: '+91 98300 20004', zone: 'South', latitude: 22.5195, longitude: 88.3653 },

  // Bhubaneswar Worker Groups (4 distinct GPS locations)
  { email: 'bbsr.patia@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Bhubaneswar Squad - Patia', phone: '+91 94370 30001', zone: 'North', latitude: 20.3588, longitude: 85.8160 },
  { email: 'bbsr.saheednagar@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Bhubaneswar Squad - Saheed Nagar', phone: '+91 94370 30002', zone: 'Central', latitude: 20.2885, longitude: 85.8436 },
  { email: 'bbsr.nayapalli@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Bhubaneswar Squad - Nayapalli', phone: '+91 94370 30003', zone: 'West', latitude: 20.3012, longitude: 85.8155 },
  { email: 'bbsr.khandagiri@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Bhubaneswar Squad - Khandagiri', phone: '+91 94370 30004', zone: 'West', latitude: 20.2582, longitude: 85.7836 },

  // Legacy Squads
  { email: 'green@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Green Squad A', phone: '+91 90000 10001', zone: 'Central', latitude: 12.9783, longitude: 77.5921 },
  { email: 'river@crew.local', password: 'Swachh123!', role: 'worker', full_name: 'River Crew B', phone: '+91 90000 10002', zone: 'Riverside', latitude: 12.9442, longitude: 77.5808 },
  { email: 'bbsr@squad.local', password: 'Swachh123!', role: 'worker', full_name: 'Bhubaneswar Squad', phone: '+91 90000 10003', zone: 'Central', latitude: 20.3568, longitude: 85.8198 },
]

export const SEED_REPORTS = [
  { category: 'Overflowing bin', location: 'MG Road, near Metro Station Gate 2', zone: 'Central', volume: 'Overflowing', hazard_flag: true, description: 'Bin has not been cleared in four days. Waste spilling onto the road and pedestrians are walking around it.', resident_name: 'Anita Rao', duplicate_count: 3, latitude: 12.9756, longitude: 77.605 },
  { category: 'Illegal dumpsite', location: 'Sector 14, behind the wholesale market', zone: 'West', volume: 'Large', hazard_flag: false, description: 'Construction debris and packaging dumped on empty plot overnight.', resident_name: 'Mohan Iyer', duplicate_count: 1, latitude: 12.962, longitude: 77.548 },
  { category: 'Blocked drain', location: 'Lake View Road, opposite Park entrance', zone: 'Riverside', volume: 'Medium', hazard_flag: true, description: 'Drain blocked with plastic and leaves. Water backing up into the street after light rain.', resident_name: 'Priya Nair', duplicate_count: 2, latitude: 12.942, longitude: 77.578 },
  { category: 'Street litter', location: 'Indiranagar 100ft Road, near bus stop', zone: 'East', volume: 'Small', hazard_flag: false, description: 'Food wrappers and cups around the bus stop after the weekend market.', resident_name: 'Rahul Das', duplicate_count: 1, latitude: 12.9719, longitude: 77.6412 },
  { category: 'Medical waste', location: 'City Hospital back gate, 4th Cross', zone: 'North', volume: 'Small', hazard_flag: true, description: 'Used syringes and gloves spotted near the hospital waste collection point.', resident_name: 'Dr. Kavya Menon', duplicate_count: 1, latitude: 13.012, longitude: 77.565 },
  { category: 'Public toilet issue', location: 'Central Bus Stand, Platform 4 exit', zone: 'Central', volume: 'Medium', hazard_flag: false, description: 'Public toilet not cleaned today and water supply is cut off.', resident_name: 'Suresh Pillai', duplicate_count: 4, latitude: 12.99, longitude: 77.57 },
]

export const SAMPLE_TASKS = [
  { crew_name: 'Green Squad A', vehicle: 'Tipper T-12', eta: '25 min' },
  { crew_name: 'River Crew B', vehicle: 'Sweeper S-07', eta: '40 min' },
]

export function makeId() {
  return crypto.randomUUID()
}

export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'worker' CHECK (role IN ('operator', 'worker')),
  full_name text NOT NULL DEFAULT 'Team member',
  phone text NOT NULL DEFAULT '',
  zone text NOT NULL DEFAULT 'Central',
  latitude double precision,
  longitude double precision,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swachhlens_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code text NOT NULL UNIQUE,
  category text NOT NULL,
  location text NOT NULL,
  zone text NOT NULL DEFAULT 'Central',
  reported_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'New',
  priority text NOT NULL DEFAULT 'Medium',
  severity_score integer NOT NULL DEFAULT 50,
  volume text NOT NULL DEFAULT 'Medium',
  hazard_flag boolean NOT NULL DEFAULT false,
  duplicate_count integer NOT NULL DEFAULT 1,
  confidence integer NOT NULL DEFAULT 90,
  description text NOT NULL DEFAULT '',
  resident_name text NOT NULL DEFAULT 'Resident',
  image_url text,
  citizen_update text NOT NULL DEFAULT 'Report received and queued for analysis.',
  latitude double precision,
  longitude double precision,
  citizen_phone text NOT NULL DEFAULT '',
  approval_status text NOT NULL DEFAULT 'Pending',
  ai_analysis jsonb,
  team_size integer NOT NULL DEFAULT 1,
  assigned_worker_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swachhlens_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES swachhlens_reports(id) ON DELETE CASCADE,
  task_code text NOT NULL UNIQUE,
  crew_name text NOT NULL,
  vehicle text NOT NULL,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  eta text NOT NULL DEFAULT '30 min',
  status text NOT NULL DEFAULT 'Assigned',
  completion_score integer,
  before_image_url text,
  after_image_url text,
  worker_note text NOT NULL DEFAULT '',
  escalated boolean NOT NULL DEFAULT false,
  latitude double precision,
  longitude double precision,
  worker_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ai_rating integer,
  ai_feedback text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  path text NOT NULL UNIQUE,
  data_url text NOT NULL,
  mime_type text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS swachhlens_reports_status_idx ON swachhlens_reports(status);
CREATE INDEX IF NOT EXISTS swachhlens_reports_priority_idx ON swachhlens_reports(priority);
CREATE INDEX IF NOT EXISTS swachhlens_reports_zone_idx ON swachhlens_reports(zone);
CREATE INDEX IF NOT EXISTS swachhlens_reports_approval_idx ON swachhlens_reports(approval_status);
CREATE INDEX IF NOT EXISTS swachhlens_tasks_report_id_idx ON swachhlens_tasks(report_id);
CREATE INDEX IF NOT EXISTS swachhlens_tasks_status_idx ON swachhlens_tasks(status);
CREATE INDEX IF NOT EXISTS swachhlens_tasks_worker_idx ON swachhlens_tasks(worker_id);
`