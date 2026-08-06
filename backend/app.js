import express from 'express'
import cors from 'cors'
import healthRoutes from './routes/healthRoutes.js'
import queryRoutes from './routes/queryRoutes.js'
import authRoutes from './routes/authRoutes.js'
import storageRoutes from './routes/storageRoutes.js'
import agentRoutes from './routes/agentRoutes.js'

export function createApp() {
  const app = express()

  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '25mb' }))

  app.use('/api/health', healthRoutes)
  app.use('/api/query', queryRoutes)
  app.use('/api/auth', authRoutes)
  app.use('/api/storage', storageRoutes)
  // Agentic pipeline endpoints — one route file, mounted per phase
  app.use('/api/agents', agentRoutes)

  return app
}
