import { queryDatabase } from '../models/database.js'

export async function handleQuery(req, res) {
  try {
    const result = await queryDatabase(req.body || {})
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}
