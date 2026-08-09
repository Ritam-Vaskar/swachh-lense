import 'dotenv/config'
import { createApp } from './app.js'
import { seedDatabaseIfNeeded } from './models/database.js'
import { startEscalationAgent } from './agents/escalationAgent.js'

const app = createApp()
const port = Number(process.env.PORT || 3001)

await seedDatabaseIfNeeded()

// Start the Escalation Agent (checks every 60 seconds)
startEscalationAgent(60000)

app.listen(port, () => {
  console.log(`SwachhLens API listening on http://localhost:${port}`)
})