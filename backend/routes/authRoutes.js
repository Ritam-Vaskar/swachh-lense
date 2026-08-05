import { Router } from 'express'
import { handleEnsureUser, handleSignIn, handleSignUp } from '../controllers/authController.js'

const router = Router()

router.post('/signup', handleSignUp)
router.post('/signin', handleSignIn)
router.post('/ensure', handleEnsureUser)

export default router
