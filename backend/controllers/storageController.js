import { getPool } from '../models/database.js'

export async function handleUpload(req, res) {
  try {
    const { bucket = 'swachhlens-evidence', path, dataUrl, mimeType = 'application/octet-stream', size = 0, name = '' } = req.body || {}
    if (!path || !dataUrl) {
      res.status(400).json({ error: 'path and dataUrl are required' })
      return
    }

    const pool = getPool()
    await pool.query(
      `CREATE TABLE IF NOT EXISTS media_uploads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket text NOT NULL,
        path text NOT NULL UNIQUE,
        data_url text NOT NULL,
        mime_type text NOT NULL,
        size bigint NOT NULL DEFAULT 0,
        name text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    )
    await pool.query(
      `INSERT INTO media_uploads (bucket, path, data_url, mime_type, size, name)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (path) DO UPDATE SET data_url = EXCLUDED.data_url, mime_type = EXCLUDED.mime_type, size = EXCLUDED.size, name = EXCLUDED.name`,
      [bucket, path, dataUrl, mimeType, size, name],
    )

    res.json({ bucket, path, data: { publicUrl: dataUrl, name, mimeType, size } })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}
