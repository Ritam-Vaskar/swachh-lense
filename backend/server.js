import 'dotenv/config'
import { createApp } from './app.js'
import { seedDatabaseIfNeeded } from './models/database.js'

const app = createApp()
const port = Number(process.env.PORT || 3001)

await seedDatabaseIfNeeded()

app.listen(port, () => {
  console.log(`SwachhLens API listening on http://localhost:${port}`)
})