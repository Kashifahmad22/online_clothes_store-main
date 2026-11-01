// Rendered tests for ProductItem (real component in jsdom via Vite's SSR loader) plus pure tests for the card
// helpers. Product objects are MOCK data shaped like the public API; nothing here touches the backend or MongoDB.
import test, { before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
const defineGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle']) {
  defineGlobal(name, name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] ?? dom.window)
}
defineGlobal('window', dom.window)
defineGlobal('navigator', dom.window.navigator)
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)
window.scrollTo = () => {}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const { createServer } = await import('vite')

const h = React.createElement
let vite
let ProductItem
let display
let mounted

before(async () => {
  vite = await createServer({
    root,
    configFile: path.join(root, 'vite.config.js'),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null }
  })
  ProductItem = (await vite.ssrLoadModule('/src/components/ProductItem.jsx')).default
  display = await vite.ssrLoadModule('/src/utils/productDisplay.js')
})
after(async () => { await vite.close() })
afterEach(async () => {
  if (!mounted) return
  await act(async () => { mounted.reactRoot.unmount() })
  mounted.container.remove()
  mounted = null
})

const variant = (overrides = {}) => ({ _id: 'v', sku: 'SECRET-SKU-1', stockOnHand: 9, reserved: 0, active: true, price: 1000, ...overrides })
const makeProduct = (overrides = {}) => ({
  _id: 'p1', slug: 'red-saree', name: 'Red Silk Saree', price: 1000, mrp: 1500, productType: 'saree', category: 'Sarees',
  details: { fabric: 'Banarasi Silk', colour: 'Maroon' }, images: [{ url: 'https://mock.test/p1.jpg', role: 'primary' }],
  variants: [variant()], ...overrides
})

const render = async product => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const reactRoot = createRoot(container)
  await act(async () => { reactRoot.render(h(MemoryRouter, null, h(ProductItem, { product }))) })
  mounted = { reactRoot, container }
  return container
}
const text = el => el.textContent.replace(/\s+/g, ' ').trim()

test('fabric and colour appear only from valid public details', async () => {
  const card = await render(makeProduct())
  assert.equal(text(card.querySelector('.product-card__attributes')), 'Banarasi Silk · Maroon')
  const onlyFabric = await (async () => { await act(async () => { mounted.reactRoot.unmount() }); mounted.container.remove(); return render(makeProduct({ details: { fabric: 'Cotton' } })) })()
  assert.equal(text(onlyFabric.querySelector('.product-card__attributes')), 'Cotton')
})

test('absent, blank, placeholder or non-string attributes render no attribute line and no label', async () => {
  for (const details of [undefined, {}, { fabric: '   ', colour: '' }, { fabric: 'N/A', colour: 'none' }, { fabric: 42, colour: null }, { fabric: ['Silk'] }]) {
    const card = await render(makeProduct({ details }))
    assert.equal(card.querySelector('.product-card__attributes'), null, JSON.stringify(details))
    assert.doesNotMatch(text(card), /Fabric|Colour|undefined|null|N\/A/i)
    await act(async () => { mounted.reactRoot.unmount() })
    mounted.container.remove()
    mounted = null
  }
})

test('attributes are never inferred from name or category, and SKU is never exposed', async () => {
  const card = await render(makeProduct({ name: 'Maroon Silk Saree', category: 'Silk Sarees', details: {} }))
  assert.equal(card.querySelector('.product-card__attributes'), null)
  assert.doesNotMatch(text(card), /SECRET-SKU/)
})

test('single variant shows a plain price with the real discount', async () => {
  const card = await render(makeProduct())
  assert.doesNotMatch(text(card), /From/)
  assert.match(text(card), /₹1,000/)
  assert.match(text(card), /₹1,500/)
  assert.match(text(card), /33\.3% off/)
  assert.match(text(card.querySelector('.product-card__badge')), /33% off/)
})

test('identical prices across active variants show a normal price, not "From"', async () => {
  const card = await render(makeProduct({ variants: [variant({ _id: 'a' }), variant({ _id: 'b' })] }))
  assert.doesNotMatch(text(card), /From/)
  assert.match(text(card), /33\.3% off/)
})

test('different active-variant prices show "From" the lowest and withhold the single-MRP discount', async () => {
  const card = await render(makeProduct({ variants: [variant({ _id: 'a', price: 1200 }), variant({ _id: 'b', price: 900 })] }))
  assert.match(text(card), /From ₹900/)
  assert.doesNotMatch(text(card), /% off|₹1,500/)
  assert.equal(card.querySelector('.product-card__badge'), null)
})

test('inactive variants never influence the displayed price', async () => {
  const card = await render(makeProduct({ variants: [variant({ _id: 'a', price: 1000 }), variant({ _id: 'b', price: 400, active: false })] }))
  assert.doesNotMatch(text(card), /From|₹400/)
  assert.match(text(card), /₹1,000/)
})

test('missing or invalid price data degrades safely', async () => {
  assert.deepEqual(display.getPriceSummary({ variants: [], price: NaN }), { price: null, from: false, mrp: null })
  assert.deepEqual(display.getPriceSummary({ variants: [variant({ price: -5 }), variant({ price: 'x' })] }), { price: null, from: false, mrp: null })
  assert.deepEqual(display.getPriceSummary(undefined), { price: null, from: false, mrp: null })
  assert.equal(display.getPriceSummary({ variants: [variant({ price: NaN })], price: 700 }).price, 700)
  const card = await render(makeProduct({ price: undefined, mrp: undefined, variants: [] }))
  assert.match(text(card), /Price unavailable/)
})

test('MRP at or below the price shows no discount, and float noise does not create a fake "From"', async () => {
  assert.equal(display.getPriceSummary({ price: 1000, mrp: 1000, variants: [] }).mrp, null)
  assert.equal(display.getPriceSummary({ price: 1000, mrp: 900, variants: [] }).mrp, null)
  assert.equal(display.getPriceSummary({ variants: [variant({ price: 0.1 + 0.2 }), variant({ price: 0.3 })] }).from, false)
})

test('low stock shows a subtle note without quantities when the backend flag is true and the product is available', async () => {
  const card = await render(makeProduct({ lowStock: true, variants: [variant({ stockOnHand: 1 })] }))
  assert.equal(text(card.querySelector('.product-card__low-stock')), 'Only a few left')
  assert.equal(card.querySelector('.merch-badge--low-stock'), null)
  assert.doesNotMatch(text(card), /\d\s*(?:pieces?|units?|items?)?\s*left|\bstock\b/i)
})

test('no low-stock note when the flag is false, missing, or not strictly true', async () => {
  for (const lowStock of [false, undefined, 'yes', 1]) {
    const card = await render(makeProduct({ lowStock }))
    assert.equal(card.querySelector('.product-card__low-stock'), null, String(lowStock))
    await act(async () => { mounted.reactRoot.unmount() })
    mounted.container.remove()
    mounted = null
  }
})

test('out-of-stock products show Unavailable and no urgency or badges', async () => {
  const card = await render(makeProduct({ lowStock: true, bestseller: true, variants: [variant({ stockOnHand: 0 })] }))
  assert.match(text(card.querySelector('.product-card__sold-out')), /Unavailable/)
  assert.equal(card.querySelector('.product-card__low-stock'), null)
  assert.equal(card.querySelector('.merch-badges'), null)
})

test('Best Seller and Fast Selling badges are preserved, alongside the low-stock note', async () => {
  let card = await render(makeProduct({ bestseller: true, lowStock: true }))
  assert.equal(text(card.querySelector('.merch-badge--best-seller')), 'Best Seller')
  assert.equal(text(card.querySelector('.product-card__low-stock')), 'Only a few left')
  await act(async () => { mounted.reactRoot.unmount() })
  mounted.container.remove()
  mounted = null
  card = await render(makeProduct({ fastSelling: true }))
  assert.equal(text(card.querySelector('.merch-badge--fast-selling')), 'Fast Selling')
})

test('the card is one accessible link with the product name and the existing slug URL', async () => {
  const card = await render(makeProduct({ bestseller: true, lowStock: true }))
  const links = card.querySelectorAll('a')
  assert.equal(links.length, 1)
  assert.equal(links[0].getAttribute('href'), '/product/red-saree')
  assert.equal(links[0].getAttribute('aria-label'), 'View Red Silk Saree')
  assert.equal(card.querySelector('img').getAttribute('alt'), 'Red Silk Saree')
  const fallback = await (async () => { await act(async () => { mounted.reactRoot.unmount() }); mounted.container.remove(); return render(makeProduct({ slug: undefined })) })()
  assert.equal(fallback.querySelector('a').getAttribute('href'), '/product/p1')
})
