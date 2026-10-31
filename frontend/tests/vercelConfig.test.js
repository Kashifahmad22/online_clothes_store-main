import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const rewrite = config.rewrites[0]
const rewritten = path => new RegExp(`^${rewrite.source}$`).test(path)
const headers = Object.fromEntries(config.headers[0].headers.map(h => [h.key, h.value]))
const directive = name => headers['Content-Security-Policy']
    .split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `)) || ''

test('storefront routes rewrite to index.html', () => {
    assert.equal(rewrite.destination, '/index.html')
    const routes = ['/', '/collection', '/collections/dhanteras', '/category/silk', '/product/64b7f0c2a1',
        '/cart', '/login', '/place-order', '/orders', '/verify', '/about', '/contact', '/privacy-policy']
    for (const route of routes) assert.ok(rewritten(route), route)
})

test('assets and files with extensions are not rewritten', () => {
    for (const file of ['/assets/index-abc.js', '/assets/missing.css', '/assets/missing.png',
        '/favicon.svg', '/robots.txt', '/sitemap.xml', '/missing.jpg']) {
        assert.ok(!rewritten(file), file)
    }
})

test('CSP allows Razorpay, Cloudinary, fonts and the API, and nothing broader for scripts', () => {
    assert.equal(directive('script-src'), "script-src 'self' https://checkout.razorpay.com https://cdn.razorpay.com")
    assert.match(directive('frame-src'), /https:\/\/\*\.razorpay\.com/)
    assert.match(directive('connect-src'), /https:\/\/patna-saree-handloom\.onrender\.com/)
    assert.match(directive('img-src'), /https:\/\/res\.cloudinary\.com/)
    assert.match(directive('style-src'), /https:\/\/fonts\.googleapis\.com/)
    assert.match(directive('font-src'), /https:\/\/fonts\.gstatic\.com/)
    assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/)
    assert.match(headers['Content-Security-Policy'], /object-src 'none'/)
    assert.doesNotMatch(directive('script-src'), /unsafe/)
})

test('security headers are present', () => {
    assert.match(headers['Strict-Transport-Security'], /^max-age=\d+/)
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(headers['X-Frame-Options'], 'DENY')
    assert.ok(headers['Referrer-Policy'])
})

test('robots.txt blocks private pages and does not invent a sitemap', () => {
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
    assert.match(robots, /^User-agent: \*/m)
    assert.match(robots, /Disallow: \/cart/)
    assert.doesNotMatch(robots, /^Sitemap:/mi)
})
