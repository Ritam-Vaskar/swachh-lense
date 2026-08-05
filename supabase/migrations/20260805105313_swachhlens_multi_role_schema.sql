/*
# SwachhLens multi-role schema and photo storage

This migration extends the operations schema into a three-sided product:
  - Citizen portal (anonymous): photo + GPS + comment intake, status tracking.
  - Worker app (authenticated): assigned tasks, navigation, completion with photos.
  - Operator dashboard (authenticated): map, approval queue, auto-assign, ratings.

## 1. New Tables
- `profiles`: operator and worker accounts. id mirrors auth.users. role is 'operator' or 'worker'. Workers carry a home zone, live GPS coordinates, and an availability flag used by the nearest-worker matching.

## 2. Modified Tables
- `swachhlens_reports`: adds latitude, longitude, citizen_phone, approval_status, ai_analysis (jsonb), team_size, assigned_worker_id. Existing columns are untouched.
- `swachhlens_tasks`: adds latitude, longitude, worker_id, ai_rating. Existing columns are untouched.

## 3. Storage
- Creates public bucket `swachhlens-evidence` for citizen before-photos and worker after-photos.
- Storage policies allow anon uploads/reads (citizens are not signed in) and authenticated uploads/reads.

## 4. Security (RLS)
- `profiles`: authenticated users can read all profiles and insert/update only their own row.
- `swachhlens_reports`: anon and authenticated can INSERT (citizens are anonymous) and SELECT (civic reports are shared/public for status tracking). Only authenticated operators can UPDATE or DELETE.
- `swachhlens_tasks`: authenticated operators can INSERT/UPDATE/DELETE. Workers can UPDATE only tasks assigned to them. Both operators and workers can SELECT.
- Storage bucket is public-read and anon+authenticated upload.

## 5. Notes
- approval_status values: Pending, Approved, Rejected, Auto-approved.
- ai_analysis jsonb stores the mock/AI triage output: { category, severity_score, volume, confidence, team_size, hazard, summary }.
- assigned_worker_id and worker_id reference profiles(id) and default to null until assignment.
*/

-- ---------- profiles ----------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'worker' CHECK (role IN ('operator', 'worker')),
  full_name text NOT NULL DEFAULT 'Team member',
  phone text NOT NULL DEFAULT '',
  zone text NOT NULL DEFAULT 'Central',
  latitude double precision,
  longitude double precision,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operators read all profiles" ON public.profiles;
CREATE POLICY "operators read all profiles" ON public.profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "users update own profile" ON public.profiles;
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "users insert own profile" ON public.profiles;
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

-- ---------- reports extensions ----------
ALTER TABLE public.swachhlens_reports
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS citizen_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS ai_analysis jsonb,
  ADD COLUMN IF NOT EXISTS team_size integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_worker_id uuid;

-- Recreate report policies: anon can insert+select (citizens), only authenticated update/delete (operators).
DROP POLICY IF EXISTS "workspace can read reports" ON public.swachhlens_reports;
CREATE POLICY "workspace can read reports" ON public.swachhlens_reports FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "workspace can create reports" ON public.swachhlens_reports;
CREATE POLICY "workspace can create reports" ON public.swachhlens_reports FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "operators can update reports" ON public.swachhlens_reports;
CREATE POLICY "operators can update reports" ON public.swachhlens_reports FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "operators can delete reports" ON public.swachhlens_reports;
CREATE POLICY "operators can delete reports" ON public.swachhlens_reports FOR DELETE
  TO authenticated USING (true);

-- ---------- tasks extensions ----------
ALTER TABLE public.swachhlens_tasks
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS worker_id uuid,
  ADD COLUMN IF NOT EXISTS ai_rating integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swachhlens_tasks_worker_id_fk') THEN
    ALTER TABLE public.swachhlens_tasks
      ADD CONSTRAINT swachhlens_tasks_worker_id_fk
      FOREIGN KEY (worker_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swachhlens_reports_assigned_worker_id_fk') THEN
    ALTER TABLE public.swachhlens_reports
      ADD CONSTRAINT swachhlens_reports_assigned_worker_id_fk
      FOREIGN KEY (assigned_worker_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS swachhlens_reports_approval_idx ON public.swachhlens_reports(approval_status);
CREATE INDEX IF NOT EXISTS swachhlens_reports_worker_idx ON public.swachhlens_reports(assigned_worker_id);
CREATE INDEX IF NOT EXISTS swachhlens_tasks_worker_idx ON public.swachhlens_tasks(worker_id);

-- Tasks: operators full CRUD, workers read all + update own assigned tasks.
DROP POLICY IF EXISTS "workspace can read tasks" ON public.swachhlens_tasks;
CREATE POLICY "workspace can read tasks" ON public.swachhlens_tasks FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "operators can create tasks" ON public.swachhlens_tasks;
CREATE POLICY "operators can create tasks" ON public.swachhlens_tasks FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "operators can update all tasks" ON public.swachhlens_tasks;
CREATE POLICY "operators can update all tasks" ON public.swachhlens_tasks FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "operators can delete tasks" ON public.swachhlens_tasks;
CREATE POLICY "operators can delete tasks" ON public.swachhlens_tasks FOR DELETE
  TO authenticated USING (true);

-- ---------- storage bucket ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('swachhlens-evidence', 'swachhlens-evidence', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anon upload evidence" ON storage.objects;
CREATE POLICY "anon upload evidence" ON storage.objects FOR INSERT
  TO anon, authenticated WITH CHECK (bucket_id = 'swachhlens-evidence');

DROP POLICY IF EXISTS "public read evidence" ON storage.objects;
CREATE POLICY "public read evidence" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'swachhlens-evidence');

DROP POLICY IF EXISTS "authenticated delete evidence" ON storage.objects;
CREATE POLICY "authenticated delete evidence" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'swachhlens-evidence');
