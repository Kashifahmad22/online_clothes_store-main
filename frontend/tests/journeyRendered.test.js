// Rendered tests for the Phase 9.4R customer-journey fixes. Components run for real in jsdom (Vite SSR loader);
// axios is replaced with an in-memory MOCK, so nothing here touches a backend, MongoDB, Cloudinary or Razorpay.
import test, { before, after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
const defineGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'localStorage']) {
  defineGlobal(name, name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] ?? dom.window)
}
defineGlobal('window', dom.window)
defineGlobal('navigator', dom.window.navigator)
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)
window.scrollTo = () => {}

const React = (await import('react')).default
const { act, useContext } = await import('react')
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
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
    NotFound: (await vite.ssrLoadModule('/src/pages/NotFound.jsx')).default,
    CategoryPage: (await vite.ssrLoadModule('/src/pages/CategoryPage.jsx')).default,
    OrderConfirmation: (await vite.ssrLoadModule('/src/pages/OrderConfirmation.jsx')).default,
    Orders: (await vite.ssrLoadModule('/src/pages/Orders.jsx')).default,
    Cart: (await vite.ssrLoadModule('/src/pages/Cart.jsx')).default,
    PlaceOrder: (await vite.ssrLoadModule('/src/pages/PlaceOrder.jsx')).default,
    CheckoutSummary: (await vite.ssrLoadModule('/src/components/CheckoutSummary.jsx')).default,
    settings: await vite.ssrLoadModule('/src/config/siteSettings.js'),
    categories: await vite.ssrLoadModule('/src/config/productCategories.js')
  }
})
after(async () => { await vite.close() })

const respond = async (method, url, body) => {
  calls.push({ method, url, body })
  for (const [pattern, fn] of handlers) if (url.includes(pattern)) return { data: await fn(body) }
  throw new Error(`unmocked ${method} ${url}`)
}
beforeEach(() => {
  calls.length = 0
  handlers = []
  localStorage.clear()
  axios.get = (url, config) => respond('GET', url, config)
  axios.post = (url, body) => respond('POST', url, body)
})
afterEach(async () => {
  if (!mounted) return
  await act(async () => { mounted.reactRoot.unmount() })
  mounted.container.remove()
  mounted = null
  document.head.querySelectorAll('meta[name="robots"]').forEach(el => el.remove())
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

const baseContext = (overrides = {}) => ({
  backendUrl: 'http://mock.test', token: 'tok', currency: '₹ ', cartItems: {}, products: [],
  productsLoading: false, productsError: '', refreshProducts: () => {}, setCartItems: () => {},
  siteSettings: mods.settings.defaultSiteSettings, getCartAmountPaise: () => 0, getShippingAmount: () => 0,
  getCartAmount: () => 0, navigate: () => {}, ...overrides
})
const withContext = (value, child, initialEntries = ['/']) =>
  h(MemoryRouter, { initialEntries }, h(mods.ctx.ShopContext.Provider, { value: baseContext(value) }, child))

const codOrder = {
  _id: '64b7f3c2a1d4e5f601234abc', orderReference: 'PSH-E5F601234ABC', date: Date.UTC(2025, 0, 15, 12),
  items: [{ productId: 'p1', variantId: 'v1', sku: 'SKU-1', name: 'Red Silk Saree', image: ['https://mock.test/a.jpg'], quantity: 2, price: 1299 }],
  subtotalPaise: 259800, shippingPaise: 5000, totalPaise: 264800, amount: 2648,
  address: { firstName: 'Asha', lastName: 'Rao', street: '1 MG Road', city: 'Patna', state: 'Bihar', zipcode: '800001', country: 'India', phone: '9876543210' },
  status: 'Order Placed', paymentMethod: 'COD', paymentStatus: 'cod_pending', payment: false
}

// ---- 404 ----
test('unknown routes render a branded not-found page with navigation and noindex', async () => {
  const container = await mount(withContext({}, h(mods.NotFound)))
  assert.equal(container.querySelector('h1').textContent, 'Page not found')
  const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'))
  assert.deepEqual(hrefs, ['/', '/category/sarees', '/collection'])
  assert.equal(document.head.querySelector('meta[name="robots"]').getAttribute('content'), 'noindex')
  assert.match(document.title, /^Page not found \|/)
  assert.equal(container.querySelectorAll('main').length, 1)
})

test('App registers a catch-all not-found route and the confirmation route', async () => {
  const fs = await import('node:fs')
  const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  assert.match(app, /<Route path='\*' element=\{<NotFound \/>\} \/>/)
  assert.match(app, /path='\/order-confirmation\/:orderId'/)
})

// ---- category availability ----
test('catalogue state: failed or loading catalogue never marks a category upcoming', () => {
  const { storefrontNavigation, catalogueState } = mods.categories
  assert.equal(catalogueState({ productsLoading: true, productsError: '' }), 'loading')
  assert.equal(catalogueState({ productsLoading: false, productsError: 'x' }), 'error')
  assert.equal(catalogueState({ productsLoading: false, productsError: '' }), 'ready')
  const status = state => Object.fromEntries(storefrontNavigation([], state).map(c => [c.slug, c.status]))
  assert.equal(status('ready').sarees, 'available')
  assert.deepEqual(Object.values(status('ready')).filter(s => s === 'upcoming').length, 3)
  for (const state of ['error', 'loading']) {
    assert.equal(Object.values(status(state)).includes('upcoming'), false, state)
    assert.equal(status(state).sarees, 'available')
  }
  assert.equal(storefrontNavigation([]).filter(c => c.status === 'upcoming').length, 3)
})

test('category page: API failure shows a recoverable error, not Coming soon', async () => {
  let retried = 0
  const container = await mount(withContext(
    { productsError: 'Network Error', refreshProducts: () => { retried += 1 } },
    h(Routes, null, h(Route, { path: '/category/:categorySlug', element: h(mods.CategoryPage) })),
    ['/category/kurtis']
  ))
  assert.doesNotMatch(text(container), /coming soon/i)
  assert.ok(container.querySelector('[role="alert"]'))
  const retry = [...container.querySelectorAll('button')].find(b => b.textContent === 'Try again')
  await act(async () => { retry.click() })
  assert.equal(retried, 1)
})

test('category page: loaded empty catalogue still shows Coming soon; loading shows a status', async () => {
  const route = h(Routes, null, h(Route, { path: '/category/:categorySlug', element: h(mods.CategoryPage) }))
  let container = await mount(withContext({}, route, ['/category/lehengas']))
  assert.match(text(container), /coming soon/i)
  await act(async () => { mounted.reactRoot.unmount() }); mounted.container.remove(); mounted = null
  container = await mount(withContext({ productsLoading: true }, route, ['/category/lehengas']))
  assert.doesNotMatch(text(container), /coming soon/i)
  assert.ok(container.querySelector('[role="status"]'))
})

// ---- confirmation ----
test('COD confirmation from the placed order shows friendly reference, items, totals and address without refetching', async () => {
  const container = await mount(withContext({}, h(Routes, null,
    h(Route, { path: '/order-confirmation/:orderId', element: h(mods.OrderConfirmation) })),
  [{ pathname: `/order-confirmation/${codOrder._id}`, state: { order: codOrder } }]))
  const body = text(container)
  assert.match(body, /Order reference: PSH-E5F601234ABC/)
  assert.match(body, /Cash on Delivery/)
  assert.match(body, /Red Silk Saree/)
  assert.match(body, /Qty 2/)
  assert.match(body, /₹2,598/)
  assert.match(body, /Shipping\s*₹50/)
  assert.match(body, /Order total\s*₹2,648/)
  assert.match(body, /1 MG Road/)
  assert.doesNotMatch(body, /cod_pending/)
  const links = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'))
  assert.ok(links.includes('/collection') && links.includes('/orders'))
  assert.equal(calls.length, 0)
})

test('refreshing the confirmation page reads existing orders and never places another order', async () => {
  handlers.push(['/api/order/userorders', () => ({ success: true, orders: [codOrder] })])
  const container = await mount(withContext({}, h(Routes, null,
    h(Route, { path: '/order-confirmation/:orderId', element: h(mods.OrderConfirmation) })),
  [`/order-confirmation/${codOrder._id}`]))
  assert.match(text(container), /PSH-E5F601234ABC/)
  assert.deepEqual(calls.map(c => c.url.replace('http://mock.test', '')), ['/api/order/userorders'])
  assert.equal(calls.some(c => c.url.includes('/order/place')), false)
})

test('confirmation reports a missing order or API failure instead of claiming success', async () => {
  handlers.push(['/api/order/userorders', () => ({ success: true, orders: [] })])
  const route = h(Routes, null, h(Route, { path: '/order-confirmation/:orderId', element: h(mods.OrderConfirmation) }))
  let container = await mount(withContext({}, route, ['/order-confirmation/64b7f3c2a1d4e5f601234abc']))
  assert.ok(container.querySelector('[role="alert"]'))
  assert.doesNotMatch(text(container), /Thank you|placed/i)
  await act(async () => { mounted.reactRoot.unmount() }); mounted.container.remove(); mounted = null
  handlers[0] = ['/api/order/userorders', () => { throw new Error('boom') }]
  container = await mount(withContext({}, route, ['/order-confirmation/64b7f3c2a1d4e5f601234abc']))
  assert.match(text(container), /boom/)
})

test('confirmation asks signed-out visitors to sign in without calling the API', async () => {
  const container = await mount(withContext({ token: '' }, h(Routes, null,
    h(Route, { path: '/order-confirmation/:orderId', element: h(mods.OrderConfirmation) })), ['/order-confirmation/abc']))
  assert.match(text(container), /Sign in to view this order/)
  assert.equal(calls.length, 0)
})

// ---- orders page ----
test('orders page shows friendly reference, payment and fulfilment labels, totals and address', async () => {
  handlers.push(['/api/order/userorders', () => ({ success: true, orders: [codOrder] })])
  const container = await mount(withContext({}, h(mods.Orders)))
  const body = text(container)
  assert.match(body, /Order PSH-E5F601234ABC/)
  assert.match(body, /Placed on 15 Jan 2025/)
  assert.match(body, /Cash on delivery/)
  assert.match(body, /pay when your order arrives/i)
  assert.match(body, /Order Placed/)
  assert.match(body, /Subtotal\s*₹2,598/)
  assert.match(body, /Order total\s*₹2,648/)
  assert.match(body, /Patna, Bihar, 800001/)
  assert.doesNotMatch(body, /cod_pending|64b7f3c2a1d4e5f601234abc/)
})

test('orders page shows retry only for eligible prepaid orders and never claims unconfirmed refunds', async () => {
  const future = new Date(Date.now() + 600000).toISOString()
  const rz = (id, extra) => ({ ...codOrder, _id: id, orderReference: `PSH-${id}`, paymentMethod: 'Razorpay', payment: false, ...extra })
  const orders = [
    rz('AAAAAAAAAAA1', { paymentStatus: 'failed', reservationHeld: true, reservationExpiresAt: future }),
    rz('BBBBBBBBBBB2', { status: 'Cancelled', paymentStatus: 'failed', reservationHeld: false }),
    rz('CCCCCCCCCCC3', { paymentStatus: 'paid', payment: true }),
    rz('DDDDDDDDDDD4', { paymentStatus: 'refunded', payment: true, refundedPaise: 264800 }),
    rz('EEEEEEEEEEE5', { paymentStatus: 'paid', payment: true, fulfillmentHold: true }),
    rz('FFFFFFFFFFF6', { status: 'Cancelled', paymentStatus: 'paid', payment: true, fulfillmentHold: true })
  ]
  handlers.push(['/api/order/userorders', () => ({ success: true, orders })])
  const container = await mount(withContext({}, h(mods.Orders)))
  const sections = Object.fromEntries([...container.querySelectorAll('section')].map(s => [s.getAttribute('aria-label').slice(-12), s]))
  const retry = s => [...s.querySelectorAll('button')].some(b => /Retry online payment/.test(b.textContent))
  assert.equal(retry(sections['AAAAAAAAAAA1']), true)
  for (const key of ['BBBBBBBBBBB2', 'CCCCCCCCCCC3', 'DDDDDDDDDDD4', 'EEEEEEEEEEE5', 'FFFFFFFFFFF6']) {
    assert.equal(retry(sections[key]), false, key)
  }
  assert.match(text(sections['EEEEEEEEEEE5']), /reviewing this order/)
  assert.match(text(sections['BBBBBBBBBBB2']), /can no longer be paid/)
  assert.match(text(sections['FFFFFFFFFFF6']), /refund has not yet been confirmed/)
  assert.doesNotMatch(text(sections['FFFFFFFFFFF6']), /has been refunded/)
  assert.match(text(sections['DDDDDDDDDDD4']), /has been refunded/)
})

test('orders page shows a pending-refund message without claiming completion or offering payment', async () => {
  const rz = (id, extra) => ({ ...codOrder, _id: id, orderReference: `PSH-${id}`, paymentMethod: 'Razorpay', payment: true, paymentStatus: 'paid', ...extra })
  handlers.push(['/api/order/userorders', () => ({ success: true, orders: [
    rz('AAAAAAAAAAA1', { refundStatus: 'pending' }),
    rz('BBBBBBBBBBB2', { refundStatus: 'none' })
  ] })])
  const container = await mount(withContext({}, h(mods.Orders)))
  const sections = Object.fromEntries([...container.querySelectorAll('section')].map(s => [s.getAttribute('aria-label').slice(-12), s]))
  assert.match(text(sections['AAAAAAAAAAA1']), /refund for this order is being processed/)
  assert.doesNotMatch(text(sections['AAAAAAAAAAA1']), /has been refunded|Refunded:/)
  assert.doesNotMatch(text(sections['BBBBBBBBBBB2']), /refund/i)
  assert.equal([...container.querySelectorAll('button')].some(b => /Retry online payment/.test(b.textContent)), false)
})

test('orders page covers empty, error and signed-out states', async () => {
  handlers.push(['/api/order/userorders', () => ({ success: true, orders: [] })])
  let container = await mount(withContext({}, h(mods.Orders)))
  assert.match(text(container), /No orders to show/)
  await act(async () => { mounted.reactRoot.unmount() }); mounted.container.remove(); mounted = null

  handlers[0] = ['/api/order/userorders', () => ({ success: false, message: 'Service down' })]
  container = await mount(withContext({}, h(mods.Orders)))
  assert.match(text(container), /Service down/)
  assert.ok([...container.querySelectorAll('button')].some(b => b.textContent === 'Try again'))
  await act(async () => { mounted.reactRoot.unmount() }); mounted.container.remove(); mounted = null

  container = await mount(withContext({ token: '' }, h(mods.Orders)))
  assert.match(text(container), /Sign in to see your orders/)
})

// ---- checkout summary ----
const quote = (overrides = {}) => ({
  success: true, hasIssues: false, subtotalPaise: 259800, shippingPaise: 5000, totalPaise: 264800,
  lines: [{ productId: 'p1', variantId: 'v1', quantity: 2, name: 'Red Silk Saree', image: 'https://mock.test/a.jpg', options: { colour: 'Red' }, unitPricePaise: 129900, lineTotalPaise: 259800, status: 'ok' }],
  ...overrides
})
const cart = { p1: { v1: 2 } }

test('checkout summary shows server-confirmed lines, options, shipping and total', async () => {
  handlers.push(['/api/order/quote', body => {
    assert.deepEqual(body.items, [{ productId: 'p1', variantId: 'v1', quantity: 2 }])
    return quote()
  }])
  const statuses = []
  const container = await mount(withContext({ cartItems: cart, getCartAmountPaise: () => 259800 }, h(mods.CheckoutSummary, { onStatusChange: s => statuses.push(s) })))
  const body = text(container)
  assert.match(body, /Red Silk Saree/)
  assert.match(body, /colour: Red/)
  assert.match(body, /Qty 2 × ₹1,299/)
  assert.match(body, /₹2,598/)
  assert.match(body, /Shipping\s*₹50/)
  assert.match(body, /Total payable\s*₹2,648/)
  assert.equal(container.querySelector('img').getAttribute('alt'), 'Red Silk Saree')
  assert.equal(statuses.at(-1), 'ready')
  assert.doesNotMatch(body, /prices have changed/)
})

test('checkout summary uses server prices when they differ from the cart and says so', async () => {
  handlers.push(['/api/order/quote', () => quote()])
  const container = await mount(withContext({ cartItems: cart, getCartAmountPaise: () => 200000 }, h(mods.CheckoutSummary, {})))
  assert.match(text(container), /prices have changed/i)
  assert.match(text(container), /Total payable\s*₹2,648/)
})

test('checkout summary flags unavailable or short-stock items and reports the issue state', async () => {
  handlers.push(['/api/order/quote', () => quote({
    hasIssues: true,
    lines: [{ ...quote().lines[0], status: 'insufficient', availableQuantity: 1 }, { productId: 'p2', variantId: 'v2', quantity: 1, status: 'unavailable' }]
  })])
  const statuses = []
  const container = await mount(withContext({ cartItems: { ...cart, p2: { v2: 1 } } }, h(mods.CheckoutSummary, { onStatusChange: s => statuses.push(s) })))
  assert.match(text(container), /Only 1 available/)
  assert.match(text(container), /No longer available/)
  assert.ok(container.querySelector('[role="alert"] a[href="/cart"]'))
  assert.equal(statuses.at(-1), 'issues')
})

test('checkout summary falls back to a clearly labelled estimate when the quote fails', async () => {
  handlers.push(['/api/order/quote', () => { throw new Error('down') }])
  const statuses = []
  const container = await mount(withContext({ cartItems: cart, getCartAmountPaise: () => 259800 }, h(mods.CheckoutSummary, { onStatusChange: s => statuses.push(s) })))
  assert.match(text(container), /estimate/i)
  assert.equal(statuses.at(-1), 'error')
})

// ---- guest cart through the real provider ----
const product = (id, variantIds) => ({
  _id: id, name: id, pricePaise: 100000, variants: variantIds.map(_id => ({ _id, active: true, stockOnHand: 10, reserved: 0 }))
})
const Probe = () => {
  const { cartItems } = useContext(mods.ctx.ShopContext)
  return h('pre', { id: 'cart' }, JSON.stringify(cartItems))
}
const provider = () => h(MemoryRouter, null, h(mods.ctx.default, null, h(Probe)))
const catalogue = products => ['/api/product/list', () => ({ success: true, products, pagination: { pages: 1 } })]

test('guest cart is restored after a refresh and reconciled with the loaded catalogue', async () => {
  localStorage.setItem('psh_guest_cart_v1', JSON.stringify({ version: 1, items: { p1: { v1: 2, vGone: 1 }, pGone: { x: 1 } } }))
  handlers.push(catalogue([product('p1', ['v1'])]))
  handlers.push(['/api/storefront/public', () => ({ success: false })])
  const container = await mount(provider())
  assert.deepEqual(JSON.parse(container.querySelector('#cart').textContent), { p1: { v1: 2 } })
  assert.deepEqual(JSON.parse(localStorage.getItem('psh_guest_cart_v1')).items, { p1: { v1: 2 } })
})

test('guest cart is kept (not wiped) when the catalogue fails to load, and bad stored data is ignored', async () => {
  localStorage.setItem('psh_guest_cart_v1', JSON.stringify({ version: 1, items: { p1: { v1: 2 } } }))
  handlers.push(['/api/product/list', () => { throw new Error('offline') }])
  handlers.push(['/api/storefront/public', () => ({ success: false })])
  let container = await mount(provider())
  assert.deepEqual(JSON.parse(container.querySelector('#cart').textContent), { p1: { v1: 2 } })
  await act(async () => { mounted.reactRoot.unmount() }); mounted.container.remove(); mounted = null

  localStorage.setItem('psh_guest_cart_v1', '{not json')
  container = await mount(provider())
  assert.deepEqual(JSON.parse(container.querySelector('#cart').textContent), {})
})

test('guest-to-login merges once into the server cart without duplicates and clears the guest copy', async () => {
  localStorage.setItem('token', 'tok')
  localStorage.setItem('psh_guest_cart_v1', JSON.stringify({ version: 1, items: { p1: { v1: 2 }, p2: { v3: 1 } } }))
  handlers.push(catalogue([product('p1', ['v1']), product('p2', ['v3'])]))
  handlers.push(['/api/storefront/public', () => ({ success: false })])
  handlers.push(['/api/cart/get', () => ({ success: true, cartData: { p1: { v1: 1 } } })])
  handlers.push(['/api/cart/update', () => ({ success: true })])
  const container = await mount(provider())
  assert.deepEqual(JSON.parse(container.querySelector('#cart').textContent), { p1: { v1: 3 }, p2: { v3: 1 } })
  const updates = calls.filter(c => c.url.includes('/api/cart/update')).map(c => c.body).sort((a, b) => a.productId.localeCompare(b.productId))
  assert.deepEqual(updates, [
    { productId: 'p1', variantId: 'v1', quantity: 3 },
    { productId: 'p2', variantId: 'v3', quantity: 1 }
  ])
  assert.equal(localStorage.getItem('psh_guest_cart_v1'), null)
  assert.equal(calls.filter(c => c.url.includes('/api/cart/get')).length, 1)
})

test('logged-in carts come from the server and are not persisted locally', async () => {
  localStorage.setItem('token', 'tok')
  handlers.push(catalogue([product('p1', ['v1'])]))
  handlers.push(['/api/storefront/public', () => ({ success: false })])
  handlers.push(['/api/cart/get', () => ({ success: true, cartData: { p1: { v1: 4 } } })])
  const container = await mount(provider())
  assert.deepEqual(JSON.parse(container.querySelector('#cart').textContent), { p1: { v1: 4 } })
  assert.equal(localStorage.getItem('psh_guest_cart_v1'), null)
  assert.equal(calls.some(c => c.url.includes('/api/cart/update')), false)
})

// ---- cart clearing after a successful COD order (real provider + real PlaceOrder and Cart pages) ----
const { useNavigate } = await import('react-router-dom')
const GoCart = () => { const go = useNavigate(); return h('button', { id: 'go-cart', onClick: () => go('/cart') }, 'go') }
const journeyApp = start => h(MemoryRouter, { initialEntries: [start] }, h(mods.ctx.default, null,
  h(Probe), h(GoCart),
  h(Routes, null,
    h(Route, { path: '/place-order', element: h(mods.PlaceOrder) }),
    h(Route, { path: '/cart', element: h(mods.Cart) }),
    h(Route, { path: '/order-confirmation/:orderId', element: h('p', { id: 'confirmed' }, 'confirmation page') }))))
const fill = async (container, values) => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  for (const [name, value] of Object.entries(values)) {
    const input = container.querySelector(`#checkout-${name}`)
    await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  }
}
const cartState = container => JSON.parse(container.querySelector('#cart').textContent)

test('after a successful COD order the cart is empty in state and UI, and stays empty after a refresh', async () => {
  localStorage.setItem('token', 'tok')
  localStorage.setItem('psh_guest_cart_v1', JSON.stringify({ version: 1, items: { p1: { v1: 2 } } }))
  let serverCart = {}
  handlers.push(catalogue([product('p1', ['v1'])]))
  handlers.push(['/api/storefront/public', () => ({ success: false })])
  handlers.push(['/api/cart/get', () => ({ success: true, cartData: serverCart })])
  handlers.push(['/api/cart/update', body => { serverCart = { ...serverCart, [body.productId]: { ...serverCart[body.productId], [body.variantId]: body.quantity } }; return { success: true } }])
  handlers.push(['/api/order/quote', () => quote({ lines: [{ ...quote().lines[0], quantity: 2 }] })])
  handlers.push(['/api/order/place', () => { serverCart = {}; return { success: true, order: codOrder } }])

  let container = await mount(journeyApp('/place-order'))
  assert.deepEqual(cartState(container), { p1: { v1: 2 } }, 'guest cart merged into the signed-in cart')

  await fill(container, { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '9876543210', street: '1 MG Road', city: 'Patna', state: 'Bihar', zipcode: '800001' })
  const submit = [...container.querySelectorAll('button[type="submit"]')].find(b => /Place COD order/i.test(b.textContent))
  assert.ok(submit, 'submit button present')
  await act(async () => { submit.click() })
  await flush()

  const placed = calls.filter(c => c.url.includes('/api/order/place'))
  assert.equal(placed.length, 1)
  assert.deepEqual(placed[0].body.items, [{ productId: 'p1', variantId: 'v1', quantity: 2 }])
  assert.ok(container.querySelector('#confirmed'), 'navigated to the confirmation route')
  assert.deepEqual(cartState(container), {}, 'cart context is empty after success')
  assert.equal(localStorage.getItem('psh_guest_cart_v1'), null)

  await act(async () => { container.querySelector('#go-cart').click() })
  await flush()
  assert.match(text(container), /Your cart is empty/)
  assert.equal(container.querySelector('.cart-line'), null)

  // Refresh: unmount everything and start a fresh provider against the (now empty) server cart.
  await act(async () => { mounted.reactRoot.unmount() }); mounted.container.remove(); mounted = null
  container = await mount(journeyApp('/cart'))
  assert.deepEqual(cartState(container), {})
  assert.match(text(container), /Your cart is empty/)
  assert.equal(container.querySelector('.cart-line'), null)
  assert.equal(localStorage.getItem('psh_guest_cart_v1'), null)
  assert.equal(calls.filter(c => c.url.includes('/api/order/place')).length, 1, 'refresh placed no second order')
})

test('COD order keeps items added after checkout started (server cart is reloaded, not wiped)', async () => {
  localStorage.setItem('token', 'tok')
  let serverCart = { p1: { v1: 2 }, p2: { v1: 1 } }
  handlers.push(catalogue([product('p1', ['v1']), product('p2', ['v1'])]))
  handlers.push(['/api/storefront/public', () => ({ success: false })])
  handlers.push(['/api/cart/get', () => ({ success: true, cartData: serverCart })])
  handlers.push(['/api/order/quote', () => quote({ lines: [{ ...quote().lines[0], quantity: 2 }] })])
  handlers.push(['/api/order/place', () => { serverCart = { p2: { v1: 1 } }; return { success: true, order: codOrder } }])
  const container = await mount(journeyApp('/place-order'))
  await fill(container, { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '9876543210', street: '1 MG Road', city: 'Patna', state: 'Bihar', zipcode: '800001' })
  const submit = [...container.querySelectorAll('button[type="submit"]')].find(b => /Place COD order/i.test(b.textContent))
  await act(async () => { submit.click() })
  await flush()
  assert.deepEqual(cartState(container), { p2: { v1: 1 } })
})

// ---- pending prepaid checkout after a refresh ----
const PENDING_ID = '64b7f3c2a1d4e5f601234abc'
const prepaidSettings = () => ({
  ...mods.settings.defaultSiteSettings,
  checkout: { ...mods.settings.defaultSiteSettings.checkout, prepaidAvailable: true }
})
const pendingOrder = extra => ({
  ...codOrder, _id: PENDING_ID, paymentMethod: 'Razorpay', paymentStatus: 'pending', payment: false,
  reservationHeld: true, reservationExpiresAt: new Date(Date.now() + 600000).toISOString(), ...extra
})
const recoveryApp = () => withContext({ siteSettings: prepaidSettings(), cartItems: { p1: { v1: 2 } } }, h(mods.PlaceOrder))
const storePending = () => window.sessionStorage.setItem('psh.pendingCheckout',
  JSON.stringify({ idempotencyKey: '11111111-2222-4333-8444-555555555555', orderId: PENDING_ID }))

test('refresh recovers a valid pending payment from server state without creating another order', async () => {
  window.sessionStorage.clear(); storePending()
  handlers.push(['/api/order/quote', () => quote()])
  handlers.push(['/api/order/userorders', () => ({ success: true, orders: [pendingOrder()] })])
  handlers.push(['/api/order/razorpay/retry', () => ({ success: true, orderId: PENDING_ID, reservationExpiresAt: pendingOrder().reservationExpiresAt })])
  const container = await mount(recoveryApp())
  assert.match(text(container), /Your items are reserved until/)
  assert.equal(calls.filter(c => c.url.endsWith('/api/order/razorpay')).length, 0, 'no new order or reservation created')
  assert.equal(calls.filter(c => c.url.includes('/razorpay/retry')).length, 1)
})

test('refresh never revives expired, cancelled, paid or reviewed orders and clears the stored attempt', async () => {
  const cases = [
    pendingOrder({ reservationExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    pendingOrder({ status: 'Cancelled', reservationHeld: false }),
    pendingOrder({ paymentStatus: 'paid', payment: true }),
    pendingOrder({ paymentStatus: 'paid', payment: true, fulfillmentHold: true, paymentIssue: 'review' }),
    pendingOrder({ paymentStatus: 'failed' })
  ]
  for (const order of cases) {
    window.sessionStorage.clear(); storePending()
    calls.length = 0; handlers = []
    handlers.push(['/api/order/quote', () => quote()])
    handlers.push(['/api/order/userorders', () => ({ success: true, orders: [order] })])
    const container = await mount(recoveryApp())
    assert.doesNotMatch(text(container), /Your items are reserved until/)
    assert.equal(calls.filter(c => c.url.includes('/razorpay/retry')).length, 0)
    assert.equal(window.sessionStorage.getItem('psh.pendingCheckout'), null)
    await act(async () => { mounted.reactRoot.unmount() }); mounted.container.remove(); mounted = null
  }
})

test('orders page shows customer-safe messages for payment exceptions and never a pay-again action', async () => {
  const rz = (id, extra) => ({ ...codOrder, _id: id, orderReference: `PSH-${id}`, paymentMethod: 'Razorpay', payment: true, paymentStatus: 'paid', ...extra })
  handlers.push(['/api/order/userorders', () => ({ success: true, orders: [
    rz('AAAAAAAAAAA1', { fulfillmentHold: true, paymentIssue: 'stock' }),
    rz('BBBBBBBBBBB2', { status: 'Cancelled', fulfillmentHold: true, paymentIssue: 'cancelled_capture' }),
    rz('CCCCCCCCCCC3', { fulfillmentHold: true, paymentIssue: 'duplicate' }),
    rz('DDDDDDDDDDD4', { fulfillmentHold: true, paymentIssue: 'review' }),
    rz('EEEEEEEEEEE5', { refundStatus: 'failed' }),
    rz('FFFFFFFFFFF6', { paymentStatus: 'refunded', refundedPaise: 264800, refundStatus: 'processed' })
  ] })])
  const container = await mount(withContext({}, h(mods.Orders)))
  const sections = Object.fromEntries([...container.querySelectorAll('section')].map(s => [s.getAttribute('aria-label').slice(-12), s]))
  assert.match(text(sections['AAAAAAAAAAA1']), /item is currently unavailable/)
  assert.match(text(sections['BBBBBBBBBBB2']), /arrived after this order was cancelled/)
  assert.match(text(sections['CCCCCCCCCCC3']), /more than one payment/)
  assert.match(text(sections['DDDDDDDDDDD4']), /do not need to pay again/)
  assert.match(text(sections['EEEEEEEEEEE5']), /could not be completed/)
  assert.match(text(sections['FFFFFFFFFFF6']), /has been refunded/)
  assert.equal([...container.querySelectorAll('button')].some(b => /Retry online payment/.test(b.textContent)), false)
  assert.doesNotMatch(text(container), /anomaly|gateway|razorpay_|pay_[A-Za-z0-9]/i)
})
// ---- Delivery PIN checker and quantity selector (mocked API, rendered) ----
const typeInto = async (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}
const submitPin = async container => {
  await act(async () => { container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
  await flush()
}
const checker = async () => {
  const DeliveryChecker = (await vite.ssrLoadModule('/src/components/DeliveryChecker.jsx')).default
  return mount(h(DeliveryChecker, { backendUrl: 'http://mock.test' }))
}

test('delivery checker rejects invalid PIN codes without calling the API', async () => {
  window.sessionStorage.clear()
  const container = await checker()
  await typeInto(container.querySelector('input'), '12345')
  await submitPin(container)
  assert.match(text(container), /valid 6-digit PIN code/)
  await typeInto(container.querySelector('input'), '012345')
  await submitPin(container)
  assert.match(text(container), /valid 6-digit PIN code/)
  assert.equal(calls.length, 0)
})

test('delivery checker shows a courier estimate only when the server returns one, and remembers the PIN', async () => {
  window.sessionStorage.clear()
  handlers.push(['/api/delivery/check', () => ({ success: true, status: 'serviceable', estimate: { from: '2026-11-07', to: '2026-11-10' } })])
  const container = await checker()
  await typeInto(container.querySelector('input'), '800001')
  await submitPin(container)
  assert.equal(calls[0].body.params.pincode, '800001')
  assert.match(text(container), /Delivery is available/)
  assert.match(text(container), /Courier estimate: 7 Nov – 10 Nov/)
  assert.match(text(container), /not a guaranteed date/)
  assert.equal(window.sessionStorage.getItem('psh.deliveryPin'), '800001')
})

test('delivery checker: serviceable without an estimate promises no date', async () => {
  window.sessionStorage.clear()
  handlers.push(['/api/delivery/check', () => ({ success: true, status: 'serviceable' })])
  const container = await checker()
  await typeInto(container.querySelector('input'), '800001')
  await submitPin(container)
  assert.doesNotMatch(text(container), /estimate:/i)
  assert.match(text(container), /confirmed before dispatch/)
})

test('delivery checker distinguishes manual confirmation, not serviceable and unavailable', async () => {
  window.sessionStorage.clear()
  const answers = [
    [{ success: true, status: 'manual_confirmation' }, /needs manual confirmation/],
    [{ success: true, status: 'not_serviceable' }, /not available to this PIN code/]
  ]
  for (const [body, pattern] of answers) {
    handlers.length = 0
    handlers.push(['/api/delivery/check', () => body])
    const container = await checker()
    await typeInto(container.querySelector('input'), '800001')
    await submitPin(container)
    assert.match(text(container), pattern)
    assert.doesNotMatch(text(container), /estimate:/i)
    await act(async () => { mounted.reactRoot.unmount() })
    mounted.container.remove()
    mounted = null
  }
  handlers.length = 0
  window.sessionStorage.clear()
  handlers.push(['/api/delivery/check', () => { const error = new Error('503'); error.response = { data: { success: true, status: 'unavailable' } }; throw error }])
  const container = await checker()
  await typeInto(container.querySelector('input'), '800001')
  await submitPin(container)
  assert.match(text(container), /could not check delivery right now/)
  assert.equal(window.sessionStorage.getItem('psh.deliveryPin'), null)
})

test('delivery checker shows a retryable error when the request fails', async () => {
  window.sessionStorage.clear()
  handlers.push(['/api/delivery/check', () => { throw new Error('network') }])
  const container = await checker()
  await typeInto(container.querySelector('input'), '800001')
  await submitPin(container)
  assert.match(text(container), /could not check delivery right now/)
  assert.equal(container.querySelector('button[type="submit"]').disabled, false)
})

test('quantity selector steps within 1..max and disables the plus button at the limit', async () => {
  const QuantitySelector = (await vite.ssrLoadModule('/src/components/QuantitySelector.jsx')).default
  const Harness = () => {
    const [value, setValue] = React.useState('1')
    return h(QuantitySelector, { value, max: 3, onChange: setValue })
  }
  const container = await mount(h(Harness))
  const plus = () => container.querySelector('button[aria-label="Increase quantity"]')
  const minus = () => container.querySelector('button[aria-label="Decrease quantity"]')
  const input = () => container.querySelector('input')
  assert.equal(minus().disabled, true)
  for (let i = 0; i < 5; i += 1) await act(async () => { plus().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(input().value, '3')
  assert.equal(plus().disabled, true)
  await act(async () => { minus().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(input().value, '2')
  assert.equal(plus().disabled, false)
})

test('quantity selector is fully disabled when nothing more can be added', async () => {
  const QuantitySelector = (await vite.ssrLoadModule('/src/components/QuantitySelector.jsx')).default
  const container = await mount(h(QuantitySelector, { value: '1', max: 0, onChange: () => {} }))
  assert.equal([...container.querySelectorAll('button, input')].every(el => el.disabled), true)
})
