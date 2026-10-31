import express from 'express';
import rateLimit from 'express-rate-limit';
import { loginUser,registerUser,adminLogin } from '../controllers/userController.js';

const userRouter = express.Router();
const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Too many authentication attempts. Try again later.' }
});

userRouter.post('/register',authRateLimit,registerUser)
userRouter.post('/login',authRateLimit,loginUser)
userRouter.post('/admin',authRateLimit,adminLogin)

export default userRouter;