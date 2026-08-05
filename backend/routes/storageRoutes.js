import { Router } from 'express'
import { handleUpload } from '../controllers/storageController.js'

const router = Router()

router.post('/upload', handleUpload)

export default router
