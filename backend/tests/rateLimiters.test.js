import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import express from 'express'
import {
    WEBHOOK_PATH,
    createAdminLoginLimiter,
    createGeneralApiLimiter,
    createWebhookLimiter
} from '../middleware/rateLimiters.js'
import { verifyWebhookSignature } from '../utils/paymentSecurity.js'

const SECRET = 'test-only-webhook-secret'

const startApp = async ({ hops = 0, generalLimit = 3, webhookLimit = 5, adminLimit = 2 } = {}) => {
    const app = express()
    app.set('trust proxy', hops)
    app.use(WEBHOOK_PATH, createWebhookLimiter({ limit: webhookLimit }), express.raw({ type: 'application/json' }))
    app.use(express.json())
    app.use('/api', createGeneralApiLimiter({ limit: generalLimit }))
    app.post(WEBHOOK_PATH, (req, res) => {
        const signature = req.get('x-razorpay-signature')
        if (!verifyWebhookSignature(req.body, signature, SECRET)) {
            return res.status(400).json({ success: false })
        }
        return res.json({ success: true })
    })
    app.get('/api/ping', (req, res) => res.json({ ip: req.ip }))
    app.post('/api/user/admin', createAdminLoginLimiter({ limit: adminLimit }), (req, res) =>
        res.status(req.body?.ok ? 200 : 401).json({ success: Boolean(req.body?.ok) }))
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
    })
    const base = `http://127.0.0.1:${server.address().port}`
    return { base, close: () => new Promise(resolve => server.close(resolve)) }
}

const get = (base, xff, path = '/api/ping') =>
    fetch(base + path, { headers: xff ? { 'X-Forwarded-For': xff } : {} })

const signedPost = (base, body, signature, path = WEBHOOK_PATH) => fetch(base + path, {
    method: 'POST',
    headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature ?? createHmac('sha256', SECRET).update(body).digest('hex')
    },
    body
})

// Models Cloudflare -> Render proxy -> app: the app sees "<client-supplied>, <real client>, <edge>".
const chain = (client, forged = '198.51.100.250') => `${forged}, ${client}, 172.70.0.1`

test('with the correct hop count each client network gets its own bucket', async () => {
    const { base, close } = await startApp({ hops: 2 })
    try {
        for (let i = 0; i < 3; i++) assert.equal((await get(base, chain('203.0.113.1'))).status, 200)
        assert.equal((await get(base, chain('203.0.113.1'))).status, 429)
        assert.equal((await get(base, chain('203.0.113.2'))).status, 200)
        const body = await (await get(base, chain('203.0.113.3'))).json()
        assert.equal(body.ip, '203.0.113.3')
    } finally { await close() }
})

test('a forged leftmost X-Forwarded-For entry cannot dodge the limit', async () => {
    const { base, close } = await startApp({ hops: 2 })
    try {
        for (let i = 0; i < 3; i++) {
            assert.equal((await get(base, chain('203.0.113.1', `192.0.2.${i}`))).status, 200)
        }
        assert.equal((await get(base, chain('203.0.113.1', '192.0.2.99'))).status, 429)
    } finally { await close() }
})

test('with no trusted proxy all clients share one bucket (the pre-fix behaviour)', async () => {
    const { base, close } = await startApp({ hops: 0 })
    const originalError = console.error
    console.error = () => {}
    try {
        for (let i = 0; i < 3; i++) assert.equal((await get(base, chain(`203.0.113.${i}`))).status, 200)
        assert.equal((await get(base, chain('203.0.113.9'))).status, 429)
    } finally { console.error = originalError; await close() }
})

test('webhook traffic does not consume the general API allowance', async () => {
    const { base, close } = await startApp({ hops: 0, generalLimit: 2, webhookLimit: 50 })
    try {
        const body = JSON.stringify({ event: 'payment.captured' })
        const variants = [WEBHOOK_PATH, `${WEBHOOK_PATH}/`, WEBHOOK_PATH.toUpperCase(), `${WEBHOOK_PATH}?x=1`]
        for (let i = 0; i < 8; i++) {
            const response = await signedPost(base, body, undefined, variants[i % variants.length])
            assert.equal(response.status, 200)
        }
        assert.equal((await get(base, null)).status, 200)
        assert.equal((await get(base, null)).status, 200)
        assert.equal((await get(base, null)).status, 429)
    } finally { await close() }
})

test('general API traffic does not consume the webhook allowance', async () => {
    const { base, close } = await startApp({ generalLimit: 1, webhookLimit: 3 })
    try {
        assert.equal((await get(base, null)).status, 200)
        assert.equal((await get(base, null)).status, 429)
        assert.equal((await signedPost(base, '{"a":1}')).status, 200)
    } finally { await close() }
})

test('webhook abuse is limited independently', async () => {
    const { base, close } = await startApp({ webhookLimit: 3 })
    try {
        for (let i = 0; i < 3; i++) {
            assert.equal((await signedPost(base, '{"a":1}', 'a'.repeat(64))).status, 400)
        }
        const blocked = await signedPost(base, '{"a":1}')
        assert.equal(blocked.status, 429)
        assert.equal((await blocked.json()).success, false)
    } finally { await close() }
})

test('webhook still verifies the raw-body signature', async () => {
    const { base, close } = await startApp({ webhookLimit: 20 })
    try {
        const body = '{"event":"payment.captured",  "spacing":"matters"}'
        assert.equal((await signedPost(base, body)).status, 200)
        assert.equal((await signedPost(base, body, 'bad-signature')).status, 400)
        const tampered = await signedPost(base, body + ' ', createHmac('sha256', SECRET).update(body).digest('hex'))
        assert.equal(tampered.status, 400)
    } finally { await close() }
})

test('admin login counts only failures and is limited per client IP', async () => {
    const { base, close } = await startApp({ hops: 2, generalLimit: 100, adminLimit: 2 })
    const login = (client, ok) => fetch(`${base}/api/user/admin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Forwarded-For': chain(client) },
        body: JSON.stringify({ ok })
    })
    try {
        for (let i = 0; i < 5; i++) assert.equal((await login('203.0.113.1', true)).status, 200)
        assert.equal((await login('203.0.113.1', false)).status, 401)
        assert.equal((await login('203.0.113.1', false)).status, 401)
        assert.equal((await login('203.0.113.1', false)).status, 429)
        assert.equal((await login('203.0.113.1', true)).status, 429)
        assert.equal((await login('203.0.113.2', false)).status, 401)
    } finally { await close() }
})
