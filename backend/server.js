import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import 'dotenv/config'
import mongoose from 'mongoose'
import connectDB from './config/mongodb.js'
import connectCloudinary from './config/cloudinary.js'
import userRouter from './routes/userRoute.js'
import productRouter from './routes/productRoute.js'
import cartRouter from './routes/cartRoute.js'
import orderRouter from './routes/orderRoute.js'
import storefrontSettingsRouter from './routes/storefrontSettingsRoute.js'
import { releaseExpiredRazorpayReservations } from './controllers/razorpayController.js'
import { configureAdminAuth } from './utils/adminCredentials.js'
import { resolveTrustProxyHops } from './utils/proxyConfig.js'
import { WEBHOOK_PATH, createGeneralApiLimiter, createWebhookLimiter } from './middleware/rateLimiters.js'

// App Config
const app = express()
const port = process.env.PORT || 4000
const configuredOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters.");
}
if (process.env.NODE_ENV === 'production') {
    const requiredProductionSettings = [
        'MONGODB_URI',
        'CLOUDINARY_NAME',
        'CLOUDINARY_API_KEY',
        'CLOUDINARY_SECRET_KEY'
    ]
    const missingSettings = requiredProductionSettings.filter(key => !process.env[key]?.trim())
    if (missingSettings.length > 0) {
        throw new Error(`Missing required production settings: ${missingSettings.join(', ')}.`)
    }
    if (configuredOrigins.length === 0) {
        throw new Error('CORS_ORIGINS must contain the exact production storefront and admin origins.')
    }
    for (const origin of configuredOrigins) {
        let parsedOrigin
        try {
            parsedOrigin = new URL(origin)
        } catch {
            throw new Error('CORS_ORIGINS must contain valid exact origins.')
        }
        if (parsedOrigin.origin !== origin || parsedOrigin.protocol !== 'https:') {
            throw new Error('Production CORS_ORIGINS must be exact HTTPS origins.')
        }
    }
}

configureAdminAuth(process.env, { production: process.env.NODE_ENV === 'production' })

const trustProxyHops = resolveTrustProxyHops(process.env.TRUST_PROXY_HOPS, {
    production: process.env.NODE_ENV === 'production'
})
if (process.env.NODE_ENV === 'production' && trustProxyHops === 0) {
    console.warn('TRUST_PROXY_HOPS is explicitly 0: rate limits key on the direct peer address. Confirm no proxy sits in front of this service.')
}
app.set('trust proxy', trustProxyHops)

// middlewares
app.disable('x-powered-by')
app.use(helmet())
const allowedOrigins = configuredOrigins.length > 0
    ? new Set(configuredOrigins)
    : process.env.NODE_ENV === 'production'
        ? new Set()
        : new Set([
            'http://localhost:5173',
            'http://localhost:5174',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:5174'
        ])
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true)
        return callback(new Error('Origin is not allowed by CORS.'))
    }
}))
app.use(WEBHOOK_PATH, createWebhookLimiter(), express.raw({
    type: 'application/json',
    limit: '1mb'
}))
app.use(express.json({ limit: '100kb' }))
app.use('/api', createGeneralApiLimiter())

app.get('/health', (req, res) => {
    const databaseReady = mongoose.connection.readyState === 1
    return res.status(databaseReady ? 200 : 503).json({
        status: databaseReady ? 'ok' : 'not_ready',
        checks: { database: databaseReady ? 'connected' : 'disconnected' }
    })
})

// api endpoints
app.use('/api/user',userRouter)
app.use('/api/product',productRouter)
app.use('/api/cart',cartRouter)
app.use('/api/order',orderRouter)
app.use('/api/storefront', storefrontSettingsRouter)

app.get('/',(req,res)=>{
    res.send("API Working")
})

app.use((error, req, res, next) => {
    if (error?.name === 'MulterError') {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, message: 'Each image must be 8 MB or smaller.' })
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ success: false, message: 'A product can have up to 12 images.' })
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            const message = error.field === 'images'
                ? 'Only JPG, PNG, and WebP images are supported.'
                : 'Product image files must use the images field.'
            return res.status(400).json({ success: false, message })
        }
        return res.status(400).json({ success: false, message: 'Invalid image upload.' })
    }
    if (error?.message === 'Origin is not allowed by CORS.') {
        return res.status(403).json({ success: false, message: 'Origin is not allowed.' })
    }
    console.error('Unhandled API error:', { name: error?.name || 'Error' })
    return res.status(500).json({ success: false, message: 'An unexpected server error occurred.' })
})

await connectDB()
await connectCloudinary()
const reservationReaper = setInterval(() => {
    releaseExpiredRazorpayReservations().catch(error => {
        console.error('Razorpay reservation cleanup failed:', { name: error.name || 'Error' })
    })
}, 60 * 1000)
reservationReaper.unref()
const server = app.listen(port, () => console.log(`Server started on PORT : ${port}`))

server.on('error', async error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Stop the existing project backend before starting another instance.`)
    } else {
        console.error('Backend failed to start:', { name: error.name || 'Error' })
    }
    await mongoose.disconnect()
    process.exitCode = 1
})

const shutdown = signal => {
    console.log(`${signal} received; closing the backend.`)
    clearInterval(reservationReaper)
    server.close(async error => {
        if (error) console.error('Failed to close the HTTP server:', { name: error.name || 'Error' })
        await mongoose.disconnect()
        process.exitCode = error ? 1 : 0
    })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))