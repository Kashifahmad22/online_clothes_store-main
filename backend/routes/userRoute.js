import express from 'express';
import { loginUser,registerUser,adminLogin } from '../controllers/userController.js';
import { createAuthLimiter, createAdminLoginLimiter } from '../middleware/rateLimiters.js';

const userRouter = express.Router();
const authRateLimit = createAuthLimiter();
const adminLoginLimit = createAdminLoginLimiter();

userRouter.post('/register',authRateLimit,registerUser)
userRouter.post('/login',authRateLimit,loginUser)
userRouter.post('/admin',adminLoginLimit,adminLogin)

export default userRouter;