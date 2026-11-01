import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

export const WEBHOOK_PATH = '/api/order/razorpay/webhook'

// IPv6 clients control a whole /64 (often more), so they are grouped by /56 to stop address rotation.
export const IPV6_SUBNET = 56

// Express routing is case-insensitive and ignores trailing slashes, so normalise the same way.
export const isWebhookRequest = req => {
    const path = (req.originalUrl || '').split('?')[0].replace(/\/+$/, '').toLowerCase()
    return path === WEBHOOK_PATH.toLowerCase()
}

// req.ip honours the configured trust-proxy hop count. A missing address falls into one shared
// bucket instead of bypassing the limiter.
export const clientKey = req => ipKeyGenerator(req.ip || 'unknown', IPV6_SUBNET)

const baseOptions = {
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: clientKey
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

// Each check can call a courier API, so it gets its own tighter per-client budget.
export const createDeliveryLimiter = ({ limit = 30 } = {}) => rateLimit({
    ...baseOptions,
    windowMs: 10 * 60 * 1000,
    limit,
    message: { success: false, message: 'Too many delivery checks. Please try again shortly.' }
})

export const createAuthLimiter = ({ limit = 10 } = {}) => rateLimit({
    ...baseOptions,
    windowMs: 15 * 60 * 1000,
    limit,
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
