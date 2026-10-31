import rateLimit from 'express-rate-limit'

export const WEBHOOK_PATH = '/api/order/razorpay/webhook'

// Express routing is case-insensitive and ignores trailing slashes, so normalise the same way.
export const isWebhookRequest = req => {
    const path = (req.originalUrl || '').split('?')[0].replace(/\/+$/, '').toLowerCase()
    return path === WEBHOOK_PATH.toLowerCase()
}

const baseOptions = {
    standardHeaders: 'draft-8',
    legacyHeaders: false
}

export const createGeneralApiLimiter = ({ limit = 300 } = {}) => rateLimit({
    ...baseOptions,
    windowMs: 15 * 60 * 1000,
    limit,
    skip: isWebhookRequest
})

// Separate bucket so storefront traffic cannot throttle Razorpay deliveries and vice versa.
export const createWebhookLimiter = ({ limit = 120 } = {}) => rateLimit({
    ...baseOptions,
    windowMs: 60 * 1000,
    limit,
    message: { success: false, message: 'Too many webhook requests.' }
})

export const createAuthLimiter = () => rateLimit({
    ...baseOptions,
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { success: false, message: 'Too many authentication attempts. Try again later.' }
})

// Counts only failed attempts per client IP and expires after the window, so there is no
// permanent lockout and an attacker on another IP cannot lock the real admin out.
export const createAdminLoginLimiter = ({ limit = 5 } = {}) => rateLimit({
    ...baseOptions,
    windowMs: 15 * 60 * 1000,
    limit,
    skipSuccessfulRequests: true,
    message: { success: false, message: 'Too many failed admin sign-in attempts. Try again in 15 minutes.' }
})
