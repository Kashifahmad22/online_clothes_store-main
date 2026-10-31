import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const rewrite = config.rewrites?.[0]
const matches = path => new RegExp(`^${rewrite.source}$`).test(path)

test('SPA routes rewrite to index.html', () => {
    assert.equal(rewrite.destination, '/index.html')
    for (const route of ['/', '/list', '/add', '/orders', '/settings', '/list/']) {
        assert.ok(matches(route), route)
    }
})

test('assets and files with extensions are not rewritten', () => {
    for (const file of ['/assets/index-abc.js', '/assets/missing.css', '/favicon.ico', '/robots.txt']) {
        assert.ok(!matches(file), file)
    }
})

test('CSP and security headers are preserved and cover Cloudinary and the API', () => {
    const headers = Object.fromEntries(config.headers[0].headers.map(h => [h.key, h.value]))
    const csp = headers['Content-Security-Policy']
    assert.match(csp, /script-src 'self'(;|$)/)
    assert.doesNotMatch(csp, /script-src[^;]*unsafe/)
    assert.match(csp, /img-src[^;]*https:\/\/res\.cloudinary\.com/)
    assert.match(csp, /connect-src 'self' https:\/\/patna-saree-handloom\.onrender\.com/)
    assert.match(csp, /frame-ancestors 'none'/)
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(headers['X-Frame-Options'], 'DENY')
})

