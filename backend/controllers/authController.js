import { ensureUser, signInUser, signUpUser } from '../models/database.js'

export async function handleSignUp(req, res) {
  try {
    const result = await signUpUser(req.body || {})
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function handleSignIn(req, res) {
  try {
    const result = await signInUser(req.body || {})
    res.json(result)
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function handleEnsureUser(req, res) {
  try {
    const result = await ensureUser(req.body || {})
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}
