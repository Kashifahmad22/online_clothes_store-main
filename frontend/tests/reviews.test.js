// Rendered tests for product reviews. Components run for real in jsdom (Vite SSR loader); axios is an in-memory MOCK,
// so nothing here touches a real backend, MongoDB or Cloudinary.
import test, { before, after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
const defineGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'localStorage', 'URL']) {
  if (name === 'URL') continue
  defineGlobal(name, name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] ?? dom.window)
}
defineGlobal('window', dom.window)
defineGlobal('navigator', dom.window.navigator)
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)
window.scrollTo = () => {}
URL.createObjectURL = () => `blob:mock-${Math.random()}`
URL.revokeObjectURL = () => {}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const { createServer } = await import('vite')
const axios = (await import('axios')).default

const h = React.createElement
let vite
let mods
let mounted
const calls = []
let handlers

before(async () => {
  vite = await createServer({
    root, configFile: path.join(root, 'vite.config.js'), appType: 'custom', logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null }
  })
  mods = {
    ctx: await vite.ssrLoadModule('/src/context/ShopContext.jsx'),
    ProductReviews: (await vite.ssrLoadModule('/src/components/ProductReviews.jsx')).default,
    ProductItem: (await vite.ssrLoadModule('/src/components/ProductItem.jsx')).default,
    seo: await vite.ssrLoadModule('/src/utils/seo.js'),
    settings: await vite.ssrLoadModule('/src/config/siteSettings.js')
  }
})
after(async () => { await vite.close() })

const respond = async (method, url, body) => {
  calls.push({ method, url, body })
  for (const [pattern, fn, verb] of handlers) if (url.includes(pattern) && (!verb || verb === method)) return { data: await fn(body) }
  throw new Error(`unmocked ${method} ${url}`)
}
beforeEach(() => {
  calls.length = 0
  handlers = []
  axios.get = (url, config) => respond('GET', url, config)
  axios.post = (url, body) => respond('POST', url, body)
})
afterEach(async () => {
  if (!mounted) return
  await act(async () => { mounted.reactRoot.unmount() })
  mounted.container.remove()
  mounted = null
})

const text = el => el.textContent.replace(/\s+/g, ' ').trim()
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
const mount = async tree => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const reactRoot = createRoot(container)
  await act(async () => { reactRoot.render(tree) })
  mounted = { reactRoot, container }
  await flush()
  return container
}
const withContext = (value, child) =>
  h(MemoryRouter, null, h(mods.ctx.ShopContext.Provider, { value: { backendUrl: 'http://mock.test', token: '', ...value } }, child))

const summary = { count: 3, average: 4.7, distribution: [0, 0, 0, 1, 2] }
const review = (id, extra = {}) => ({
  _id: id, rating: 5, title: 'Lovely', body: 'Beautiful drape', displayName: 'Asha K.', date: '2024-03-01T00:00:00.000Z',
  verifiedPurchase: false, images: [], ...extra
})

test('shows real summary, distribution, verified badge only when flagged, and review photos', async () => {
  handlers = [['/api/review/product/', () => ({
    success: true, summary,
    reviews: [review('r1', { verifiedPurchase: true, images: [{ url: 'https://cdn.test/a.jpg' }] }), review('r2')],
    pagination: { page: 1, limit: 5, total: 2, pages: 1 }
  }), 'GET']]
  const c = await mount(withContext({}, h(mods.ProductReviews, { productId: 'p1' })))
  assert.match(text(c), /4\.7/)
  assert.match(text(c), /3 reviews/)
  assert.equal(c.querySelectorAll('[aria-label="Rating breakdown"] li').length, 5)
  assert.equal(c.querySelectorAll('li > div + p, li p').length > 0, true)
  assert.equal((text(c).match(/Verified purchase/g) || []).length, 1)
  assert.ok(c.querySelector('img[alt^="Customer photo 1"]'))
  assert.ok(c.querySelector('[role="img"][aria-label="Rated 4.7 out of 5 from 3 reviews"]'))
})

test('shows an honest empty state with no fabricated stats', async () => {
  handlers = [['/api/review/product/', () => ({
    success: true, summary: { count: 0, average: 0, distribution: [0, 0, 0, 0, 0] }, reviews: [],
    pagination: { page: 1, limit: 5, total: 0, pages: 1 }
  }), 'GET']]
  const c = await mount(withContext({}, h(mods.ProductReviews, { productId: 'p1' })))
  assert.match(text(c), /No reviews yet/)
  assert.equal(c.querySelector('[aria-label="Rating breakdown"]'), null)
  assert.equal(c.querySelector('nav[aria-label="Review pages"]'), null)
})

test('paginates by requesting the next page from the backend', async () => {
  handlers = [['/api/review/product/', config => ({
    success: true, summary: { count: 6, average: 5, distribution: [0, 0, 0, 0, 6] },
    reviews: [review(`p${config.params.page}`, { body: `page ${config.params.page} body` })],
    pagination: { page: config.params.page, limit: 5, total: 6, pages: 2 }
  }), 'GET']]
  const c = await mount(withContext({}, h(mods.ProductReviews, { productId: 'p1' })))
  assert.match(text(c), /page 1 body/)
  const next = [...c.querySelectorAll('nav button')].find(b => b.textContent === 'Next')
  await act(async () => { next.click() })
  await flush()
  assert.match(text(c), /page 2 body/)
  assert.equal(calls.filter(call => call.method === 'GET').at(-1).body.params.page, 2)
})

test('guests are asked to log in instead of seeing the form', async () => {
  handlers = [['/api/review/product/', () => ({ success: true, summary, reviews: [], pagination: { page: 1, limit: 5, total: 0, pages: 1 } })]]
  const c = await mount(withContext({ token: '' }, h(mods.ProductReviews, { productId: 'p1' })))
  assert.equal(c.querySelector('form'), null)
  assert.equal(c.querySelector('a[href="/login"]').textContent, 'Log in')
})

test('logged-in customers submit with their token; star rating is required', async () => {
  handlers = [
    ['/api/review/mine/', () => ({ success: true, review: null, verifiedEligible: false }), 'GET'],
    ['/api/review/product/', () => ({ success: true, message: 'Thank you! Your review will appear once it has been approved.', summary, reviews: [], pagination: { page: 1, limit: 5, total: 0, pages: 1 } }), 'GET']
  ]
  handlers.push(['/api/review/product/', () => ({ success: true, message: 'Thank you! Your review will appear once it has been approved.' }), 'POST'])
  const c = await mount(withContext({ token: 'tok' }, h(mods.ProductReviews, { productId: 'p1' })))
  const form = c.querySelector('form')
  const setValue = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  }
  await act(async () => { setValue(form.querySelector('textarea'), 'Great saree') })
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
  assert.match(text(c), /Choose a star rating/)
  assert.equal(calls.some(call => call.method === 'POST'), false)
  await act(async () => { form.querySelector('[aria-label="5 stars"]').click() })
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
  await flush()
  const post = calls.find(call => call.method === 'POST')
  assert.ok(post)
  assert.equal(post.body.get('rating'), '5')
  assert.equal(post.body.get('body'), 'Great saree')
  assert.match(text(c), /Thank you/)
})

const baseProduct = { _id: 'p1', slug: 's', name: 'Silk Saree', price: 1000, images: [], variants: [{ _id: 'v1', active: true, stockOnHand: 3, reserved: 0, price: 1000 }] }

test('product cards show a backend rating badge only when published reviews exist', async () => {
  const withRating = await mount(withContext({}, h(mods.ProductItem, { product: { ...baseProduct, ratingSummary: { count: 24, average: 4.8, distribution: [0, 0, 0, 5, 19] } } })))
  assert.match(text(withRating), /★\s*4\.8 \(24\)/)
  assert.ok(withRating.querySelector('[aria-label="Rated 4.8 out of 5 from 24 reviews"]'))
  await act(async () => { mounted.reactRoot.unmount() })
  mounted.container.remove(); mounted = null
  const none = await mount(withContext({}, h(mods.ProductItem, { product: { ...baseProduct, ratingSummary: { count: 0, average: 0, distribution: [0, 0, 0, 0, 0] } } })))
  assert.doesNotMatch(text(none), /★/)
  await act(async () => { mounted.reactRoot.unmount() })
  mounted.container.remove(); mounted = null
  const missing = await mount(withContext({}, h(mods.ProductItem, { product: baseProduct })))
  assert.doesNotMatch(text(missing), /★/)
})

test('client structured data includes AggregateRating only with real reviews', () => {
  const options = { siteUrl: 'https://example.test', brandName: 'PSH' }
  const none = mods.seo.buildProductJsonLd({ ...baseProduct, ratingSummary: { count: 0, average: 0, distribution: [0, 0, 0, 0, 0] } }, options)
  assert.equal(none.aggregateRating, undefined)
  assert.equal(mods.seo.buildProductJsonLd(baseProduct, options).aggregateRating, undefined)
  const rated = mods.seo.buildProductJsonLd({ ...baseProduct, ratingSummary: { count: 3, average: 4.7, distribution: [0, 0, 0, 1, 2] } }, options)
  assert.equal(rated.aggregateRating.ratingValue, 4.7)
  assert.equal(rated.aggregateRating.reviewCount, 3)
})
