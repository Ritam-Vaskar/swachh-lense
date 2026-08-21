import 'dotenv/config'
import { createApp } from './app.js'
import { seedDatabaseIfNeeded } from './models/database.js'
import { startEscalationAgent } from './agents/escalationAgent.js'

const app = createApp()

// Vercel's serverless runtime imports this file and uses the default export
// as the request handler — it does NOT call app.listen().
// Locally (no VERCEL env var) we start the server the traditional way.
const isVercel = !!process.env.VERCEL

if (!isVercel) {
  const port = Number(process.env.PORT || 3001)
  await seedDatabaseIfNeeded()
  startEscalationAgent(60000)
  app.listen(port, () => {
    console.log(`SwachhLens API listening on http://localhost:${port}`)
  })
} else {
  // On Vercel: seed once on cold start, skip the long-running cron agent
  await seedDatabaseIfNeeded()
}

export default app