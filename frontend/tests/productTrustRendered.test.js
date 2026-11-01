// Rendered tests for the Product page trust block and breadcrumb (real components in jsdom, compiled through
// Vite's SSR loader). Store settings and the product are MOCKED context values: these tests prove what the page
// renders for a given settings payload. They do not call the backend, MongoDB or the real settings endpoint.
import test, { before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
const defineGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle']) {
  defineGlobal(name, name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] ?? dom.window)
}
defineGlobal('window', dom.window)
defineGlobal('navigator', dom.window.navigator)
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
const { createServer } = await import('vite')

const h = React.createElement
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let vite
let Product
let ShopContext
let defaultSiteSettings
let configured
let mounted

before(async () => {
  vite = await createServer({
    root,
    configFile: path.join(root, 'vite.config.js'),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null }
  })
  Product = (await vite.ssrLoadModule('/src/pages/Product.jsx')).default
  ShopContext = (await vite.ssrLoadModule('/src/context/ShopContext.jsx')).ShopContext
  defaultSiteSettings = (await vite.ssrLoadModule('/src/config/siteSettings.js')).defaultSiteSettings
  configured = makeConfigured()
})

after(async () => { await vite.close() })

afterEach(async () => {
  if (!mounted) return
  await act(async () => { mounted.reactRoot.unmount() })
  mounted.container.remove()
  mounted = null
})

const variant = (overrides = {}) => ({
  _id: 'v1', sku: 'SKU-1', options: { Colour: 'Red' }, stockOnHand: 5, reserved: 0, active: true, price: 1000, ...overrides
})
const makeProduct = (overrides = {}) => ({
  _id: 'p1', slug: 'red-saree', name: 'Red Silk Saree', description: 'A saree.', productType: 'saree',
  category: 'Silk Sarees', price: 1000, mrp: 1500, collections: [], details: { blousePieceIncluded: true },
  images: [{ url: 'https://mock.test/p1.jpg', role: 'primary', altText: 'Red' }], variants: [variant()], ...overrides
})
const settings = (overrides = {}) => ({
  ...defaultSiteSettings,
  siteUrl: 'https://shop.test',
  ...overrides
})

const render = async ({ product = makeProduct(), siteSettings = settings(), loaded = true, error = '', cartItems = {} } = {}) => {
  const calls = { updateQuantity: [], navigate: [] }
  const value = {
    getProductById: async () => product,
    updateQuantity: async (...args) => { calls.updateQuantity.push(args); return true },
    cartItems,
    navigate: to => calls.navigate.push(to),
    siteSettings,
    siteSettingsLoaded: loaded,
    siteSettingsError: error,
    products: []
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const reactRoot = createRoot(container)
  await act(async () => {
    reactRoot.render(h(ShopContext.Provider, { value },
      h(MemoryRouter, { initialEntries: ['/product/red-saree'] },
        h(Routes, null, h(Route, { path: '/product/:productId', element: h(Product) })))))
  })
  await act(async () => { await sleep(60) })
  mounted = { reactRoot, container }
  return { container, calls }
}

const text = el => el.textContent.replace(/\s+/g, ' ').trim()
const trust = container => container.querySelector('section.product-trust')
const row = (container, label) => [...trust(container).querySelectorAll('dl > div')]
  .find(item => text(item.querySelector('dt')) === label) || null
const click = async el => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) }
const buttons = (container, label) => [...container.querySelectorAll('button')].filter(el => text(el) === label)

const makeConfigured = () => settings({
  policies: { privacy: '', terms: '', shipping: 'We ship from Patna.', returns: 'Returns text.' },
  shipping: { feePaise: 5000, freeShippingThresholdPaise: 200000, message: 'Dispatch details are shared after confirmation.' },
  support: { phone: '+91 99999 00000', whatsapp: '', email: 'care@example.test', businessHours: '10am to 6pm', description: '' },
  checkout: { codAvailable: true, prepaidAvailable: true, serviceabilityCheckAvailable: false }
})

test('configured policies and settings are shown with links to the real policy pages', async () => {
  const { container } = await render({ siteSettings: configured })
  const shipping = row(container, 'Shipping')
  assert.match(text(shipping), /Shipping charge: ₹50\.00 per order\./)
  assert.match(text(shipping), /Free shipping on orders of ₹2,000\.00 or more\./)
  assert.match(text(shipping), /Dispatch details are shared after confirmation\./)
  assert.equal(shipping.querySelector('a').getAttribute('href'), '/shipping-policy')
  assert.equal(row(container, 'Returns').querySelector('a').getAttribute('href'), '/returns-policy')
  const payment = text(row(container, 'Payment'))
  assert.match(payment, /Cash on delivery is offered as a payment option at checkout\./)
  assert.match(payment, /Available payment options are shown at checkout\./)
  assert.doesNotMatch(payment, /Online payment is available|Pay online|Razorpay|\bUPI\b|\bcards?\b/i)
  const support = row(container, 'Support')
  assert.match(text(support), /Phone: \+91 99999 00000/)
  assert.equal(support.querySelector('a[href^="mailto:"]').getAttribute('href'), 'mailto:care@example.test')
  assert.match(text(support), /Hours: 10am to 6pm/)
  assert.equal(support.querySelector('a[href="/contact"]') !== null, true)
})

test('payment copy: Test Mode, hypothetical Live Mode, unavailable online payment and COD states', async () => {
  const cases = [
    // [label, checkout settings, expect COD line, expect "not available yet"]
    ['test mode (prepaidAvailable true, the only way the backend can report it)', { codAvailable: true, prepaidAvailable: true }, true, false],
    ['live-mode flag present but unsupported by the backend', { codAvailable: true, prepaidAvailable: true, razorpayMode: 'live' }, true, false],
    ['online payment unavailable, COD on', { codAvailable: true, prepaidAvailable: false }, true, true],
    ['COD off, online unavailable', { codAvailable: false, prepaidAvailable: false }, false, true],
    ['COD off, online flag true', { codAvailable: false, prepaidAvailable: true }, false, false],
    ['checkout object missing entirely', undefined, false, true]
  ]
  for (const [label, checkout, cod, unavailable] of cases) {
    const { container } = await render({ siteSettings: { ...makeConfigured(), checkout } })
    const payment = text(row(container, 'Payment'))
    assert.equal(/Cash on delivery is offered as a payment option at checkout\./.test(payment), cod, `${label}: COD line`)
    assert.equal(/Online payment is not available yet\./.test(payment), unavailable, `${label}: unavailable line`)
    assert.match(payment, /Available payment options are shown at checkout\./, label)
    assert.doesNotMatch(payment, /online payment is available|pay online|razorpay|\blive\b|test mode|\bsecure\b|guarantee|\bupi\b|\bcards?\b/i, label)
    await act(async () => { mounted.reactRoot.unmount() })
    mounted.container.remove()
    mounted = null
  }
})

test('trust block no longer makes PIN-code claims (the delivery checker owns them) and never promises delivery', async () => {
  const { container } = await render({ siteSettings: configured })
  assert.equal(row(container, 'PIN code'), null)
  assert.doesNotMatch(text(container), /serviceability|delivered (in|within|by)/i)
})

test('blank settings produce no fabricated policy, timeline, support or free-shipping text', async () => {
  const { container } = await render({
    siteSettings: settings({
      policies: { privacy: '', terms: '', shipping: '', returns: '' },
      shipping: { feePaise: 5000, freeShippingThresholdPaise: null, message: '' },
      support: { phone: '', whatsapp: '', email: '', businessHours: '', description: '' },
      checkout: { codAvailable: false, prepaidAvailable: false, serviceabilityCheckAvailable: false }
    })
  })
  const block = trust(container)
  assert.equal(block.querySelector('a[href="/shipping-policy"]'), null)
  assert.equal(block.querySelector('a[href="/returns-policy"]'), null)
  assert.match(text(row(container, 'Shipping')), /shipping policy has not been published yet/)
  assert.match(text(row(container, 'Returns')), /returns policy has not been published yet/)
  assert.doesNotMatch(text(block), /Free shipping|Cash on delivery|mailto|Phone:|Email:|Hours:/)
  assert.doesNotMatch(text(block), /\b\d+\s*(?:-\s*\d+\s*)?(?:business |working )?days?\b|within|guarantee|easy returns|\bfree\b/i)
  assert.equal(block.querySelector('a[href^="mailto:"]'), null)
})

test('nothing is rendered while store settings are loading, and defaults are never shown as facts', async () => {
  const { container } = await render({ loaded: false })
  assert.equal(trust(container), null)
})

test('a settings load failure shows a neutral notice and only static policy links', async () => {
  const { container } = await render({ loaded: false, error: 'down' })
  const block = trust(container)
  assert.match(text(block.querySelector('[role="status"]')), /could not be loaded/)
  assert.deepEqual([...block.querySelectorAll('a')].map(a => a.getAttribute('href')), ['/shipping-policy', '/returns-policy'])
  assert.doesNotMatch(text(block), /Cash on delivery|Shipping charge/)
})

test('zero shipping fee is reported as no charge only because the setting says so', async () => {
  const { container } = await render({ siteSettings: settings({ shipping: { feePaise: 0, freeShippingThresholdPaise: null, message: '' } }) })
  assert.match(text(row(container, 'Shipping')), /No shipping charge\./)
})

test('breadcrumb is an accessible list whose parent category links to the canonical category URL', async () => {
  const { container } = await render({ siteSettings: configured })
  const nav = container.querySelector('nav[aria-label="Breadcrumb"]')
  assert.ok(nav)
  assert.equal(nav.querySelector('ol') !== null, true)
  const links = [...nav.querySelectorAll('a')].map(a => [text(a), a.getAttribute('href')])
  assert.deepEqual(links, [['Home', '/'], ['Shop', '/collection'], ['Sarees', '/category/sarees']])
  assert.equal(text(nav.querySelector('[aria-current="page"]')), 'Red Silk Saree')
})

test('legacy suit product types link to the canonical Suit Pieces parent, never a legacy or subcategory URL', async () => {
  for (const productType of ['suit', 'suit-set']) {
    const { container } = await render({ product: makeProduct({ productType, category: 'Suits' }) })
    const hrefs = [...container.querySelectorAll('nav[aria-label="Breadcrumb"] a')].map(a => a.getAttribute('href'))
    assert.deepEqual(hrefs, ['/', '/collection', '/category/suit-pieces'], productType)
    await act(async () => { mounted.reactRoot.unmount() })
    mounted.container.remove()
    mounted = null
  }
})

test('unresolved categories are shown as plain text rather than a non-canonical link', async () => {
  const { container } = await render({ product: makeProduct({ productType: 'dress', category: 'Dresses' }) })
  const nav = container.querySelector('nav[aria-label="Breadcrumb"]')
  assert.deepEqual([...nav.querySelectorAll('a')].map(a => a.getAttribute('href')), ['/', '/collection'])
  assert.match(text(nav), /Dresses/)
})

test('trust block is labelled by its heading and every control is a native, keyboard-focusable element', async () => {
  const { container } = await render({ siteSettings: configured })
  const block = trust(container)
  const heading = block.querySelector('h2')
  assert.equal(block.getAttribute('aria-labelledby'), heading.id)
  for (const link of block.querySelectorAll('a')) {
    assert.ok(link.getAttribute('href'))
    assert.notEqual(link.getAttribute('tabindex'), '-1')
  }
  const dtCount = block.querySelectorAll('dt').length
  assert.equal(block.querySelectorAll('dd').length, dtCount)
  for (const control of container.querySelectorAll('button')) assert.notEqual(control.getAttribute('tabindex'), '-1')
})

test('Add to cart, Buy now and quantity validation still work with the trust block present', async () => {
  const { container, calls } = await render({ siteSettings: configured })
  assert.ok(trust(container))
  const input = container.querySelector('input[inputmode="numeric"]')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '99')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  assert.equal(buttons(container, 'Add to cart')[0].disabled, true)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '2')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await click(buttons(container, 'Add to cart')[0])
  assert.deepEqual(calls.updateQuantity.at(-1), ['p1', 'v1', 2])
  await click(buttons(container, 'Buy now')[0])
  assert.deepEqual(calls.navigate, ['/place-order'])
})

test('the mobile sticky purchase bar renders and adds the selected variant', async () => {
  const { container, calls } = await render({ siteSettings: configured })
  const sticky = container.querySelector('.product-sticky-cart')
  assert.ok(sticky)
  await click([...sticky.querySelectorAll('button')].find(el => text(el) === 'Add to cart'))
  assert.deepEqual(calls.updateQuantity.at(-1), ['p1', 'v1', 1])
})

test('out-of-stock variants stay disabled and the page still shows the trust block', async () => {
  const { container } = await render({
    product: makeProduct({ variants: [variant({ stockOnHand: 0 })] }), siteSettings: configured
  })
  assert.match(text(container), /Currently out of stock/)
  assert.ok(trust(container))
  assert.equal(buttons(container, 'Unavailable')[0].disabled, true)
})

test('error and not-found states are unchanged and render no trust block', async () => {
  const { container } = await render({ product: null })
  assert.equal(trust(container), null)
})
