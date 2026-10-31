import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const rewrite = config.rewrites.find(item => item.destination === '/index.html')
const crawlerRewrite = config.rewrites.find(item => item.source === '/product/:productId')
const crawlerPattern = new RegExp(`^${crawlerRewrite.has[0].value}$`)
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

test('robots.txt blocks private pages, allows the storefront and declares the sitemap', () => {
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
    assert.match(robots, /^User-agent: \*/m)
    assert.match(robots, /^Allow: \/$/m)
    assert.doesNotMatch(robots, /^Disallow: \/\s*$/m)
    for (const path of ['/cart', '/place-order', '/orders', '/login', '/verify']) {
        assert.match(robots, new RegExp(`^Disallow: ${path}$`, 'm'))
    }
    assert.match(robots, /^Sitemap: https:\/\/\S+\/sitemap\.xml$/m)
})

test('social crawlers are proxied to the backend preview, ahead of the SPA rewrite', () => {
    assert.match(crawlerRewrite.destination, /^https:\/\/patna-saree-handloom\.onrender\.com\/seo\/product\/:productId$/)
    assert.ok(config.rewrites.indexOf(crawlerRewrite) < config.rewrites.indexOf(rewrite))
    const crawlers = ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'WhatsApp/2.23.20.0 A', 'Twitterbot/1.0', 'LinkedInBot/1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)',
        'meta-externalagent/1.1', 'TelegramBot (like TwitterBot)']
    for (const agent of crawlers) assert.ok(crawlerPattern.test(agent), agent)
})

test('human browsers and search engines keep the SPA', () => {
    const humans = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0',
        'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0]',
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)']
    for (const agent of humans) assert.ok(!crawlerPattern.test(agent), agent)
})

test('sitemap and sub-sitemaps are served by the backend and placed before the SPA rewrite', () => {
    const sitemap = config.rewrites.find(item => item.source === '/sitemap.xml')
    assert.equal(sitemap.destination, 'https://patna-saree-handloom.onrender.com/sitemap.xml')
    assert.ok(config.rewrites.indexOf(sitemap) < config.rewrites.indexOf(rewrite))
    const pages = config.rewrites.find(item => item.source === '/sitemaps/:page')
    assert.equal(pages.destination, 'https://patna-saree-handloom.onrender.com/sitemaps/:page')
    assert.ok(config.rewrites.indexOf(pages) < config.rewrites.indexOf(rewrite))
})

test('rewrite order: crawler, sitemaps, then the SPA catch-all last', () => {
    assert.equal(config.rewrites.at(-1), rewrite)
    assert.ok(config.rewrites.slice(0, -1).every(item => item.destination.startsWith('https://patna-saree-handloom.onrender.com/')))
    assert.ok(!crawlerPattern.test('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 [Pinterest/iOS]'))
    assert.ok(crawlerPattern.test('Pinterestbot/1.0 (+http://www.pinterest.com/bot.html)'))
})
