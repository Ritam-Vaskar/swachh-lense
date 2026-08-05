import express from 'express'
import cors from 'cors'
import healthRoutes from './routes/healthRoutes.js'
import queryRoutes from './routes/queryRoutes.js'
import authRoutes from './routes/authRoutes.js'
import storageRoutes from './routes/storageRoutes.js'

export function createApp() {
  const app = express()

  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '25mb' }))

  app.use('/api/health', healthRoutes)
  app.use('/api/query', queryRoutes)
  app.use('/api/auth', authRoutes)
  app.use('/api/storage', storageRoutes)

  return app
}
