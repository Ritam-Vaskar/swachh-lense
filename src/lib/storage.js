import { supabase } from './supabaseClient'

const BUCKET = 'swachhlens-evidence'

export async function uploadEvidence(file, prefix = 'report') {
  const ext = file.name?.split('.').pop() || 'jpg'
  const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) return { error }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}
