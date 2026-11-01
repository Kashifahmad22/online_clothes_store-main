// Rendered UI tests: the real Collection component runs in jsdom (compiled through Vite's own SSR loader).
// The HTTP layer is a MOCKED axios adapter. These tests prove UI behaviour and the exact request parameters
// the page sends; they do NOT exercise the backend or MongoDB (see backend tests for query behaviour).
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

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route, useLocation } = await import('react-router-dom')
const axios = (await import('axios')).default
const { createServer } = await import('vite')

const h = React.createElement
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let vite
let Collection
let ShopContext

before(async () => {
  vite = await createServer({
    root,
    configFile: path.join(root, 'vite.config.js'),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null }
  })
  Collection = (await vite.ssrLoadModule('/src/pages/Collection.jsx')).default
  ShopContext = (await vite.ssrLoadModule('/src/context/ShopContext.jsx')).ShopContext
})

after(async () => {
  await vite.close()
})

const product = id => ({
  _id: id, name: `Mock ${id}`, productType: 'saree', category: 'Silk Sarees', price: 1000, variants: [], collections: [],
  images: [{ url: `https://mock.test/${id}.jpg`, altText: 'Mock', role: 'primary' }]
})

let api
let location
let mounted

const resetApi = (overrides = {}) => {
  api = { lists: [], facets: 0, listDelay: 0, listResponse: null, listStatus: 200, facetsStatus: 200, ...overrides }
  axios.defaults.adapter = async config => {
    const url = new URL(config.url, 'http://mock.test')
    const respond = (status, data) => {
      const response = { data, status, statusText: String(status), headers: {}, config, request: {} }
      if (status >= 400) throw new axios.AxiosError(data.message, 'ERR_BAD_RESPONSE', config, {}, response)
      return response
    }
    if (url.pathname.endsWith('/api/product/facets')) {
      api.facets += 1
      return respond(api.facetsStatus, api.facetsStatus === 200
        ? { success: true, facets: { fabrics: ['Silk'], colours: [], occasions: [] } }
        : { success: false, message: 'Facets down' })
    }
    if (url.pathname.endsWith('/api/product/list')) {
      api.lists.push({ ...config.params })
      if (api.listDelay) await sleep(api.listDelay)
      if (api.listStatus !== 200) return respond(api.listStatus, { success: false, message: 'Catalogue exploded' })
      return respond(200, api.listResponse || {
        success: true, products: [product('p1'), product('p2')], pagination: { page: 1, pages: 1, total: 2 }
      })
    }
    return respond(404, { success: false, message: 'unmocked' })
  }
}

const Probe = () => {
  location = useLocation()
  return null
}

const render = async url => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const reactRoot = createRoot(container)
  await act(async () => {
    reactRoot.render(h(ShopContext.Provider, { value: { backendUrl: 'http://mock.test' } },
      h(MemoryRouter, { initialEntries: [url] },
        h(Probe),
        h(Routes, null,
          h(Route, { path: '/collection', element: h(Collection) }),
          h(Route, { path: '/category/:categorySlug', element: h(Collection, { mode: 'category' }) })))))
  })
  mounted = { reactRoot, container }
  await settle()
  return container
}

const settle = async (ms = 320) => { await act(async () => { await sleep(ms) }) }

afterEach(async () => {
  if (!mounted) return
  await act(async () => { mounted.reactRoot.unmount() })
  mounted.container.remove()
  mounted = null
})

const text = el => el.textContent.replace(/\s+/g, ' ').trim()
const select = (container, label) => [...container.querySelectorAll('label.catalogue-filter')]
  .find(el => text(el.querySelector('span')) === label)?.querySelector('select') || null
const options = el => [...el.querySelectorAll('option')].map(option => text(option))
const change = async (el, value) => {
  await act(async () => {
    el.value = value
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await settle()
}
const click = async el => {
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await settle()
}
const chips = container => [...container.querySelectorAll('ul[aria-label="Active filters"] button')].map(el => text(el))
const chipButton = (container, label) => container.querySelector(`button[aria-label="Remove filter ${label}"]`)
const clearButton = container => [...container.querySelectorAll('aside button')].find(el => text(el) === 'Clear')
const lastList = () => api.lists.at(-1)
const params = () => new URLSearchParams(location.search)

test('Category filter has exactly the four canonical options and there is no Product type filter', async () => {
  resetApi()
  const container = await render('/collection')
  assert.deepEqual(options(select(container, 'Category')),
    ['All categories', 'Sarees', 'Suit Pieces', 'Lehengas', 'Kurtis'])
  assert.equal(select(container, 'Product type'), null)
  const labels = [...container.querySelectorAll('label.catalogue-filter > span')].map(el => text(el))
  assert.deepEqual(labels, ['Category', 'Fabric', 'Colour', 'Occasion'])
  const all = options(select(container, 'Category')).join('|').toLowerCase()
  for (const raw of ['suit pants', 'silk sarees', 'cotton sarees', 'suit piece|', 'dress', 'other']) assert.equal(all.includes(raw), false, raw)
})

test('the category list does not depend on the facets API', async () => {
  resetApi({ facetsStatus: 500 })
  const container = await render('/collection')
  assert.match(text(container), /Some catalogue filters are unavailable: Facets down/)
  assert.equal(options(select(container, 'Category')).length, 5)
})

test('selecting Sarees and Suit Pieces sends the canonical parameter and updates URL and chip', async () => {
  resetApi()
  const container = await render('/collection?search=silk&sort=price-asc&fabric=Silk')
  await change(select(container, 'Category'), 'sarees')
  assert.equal(lastList().canonicalCategory, 'sarees')
  assert.equal(lastList().category, undefined)
  assert.equal(lastList().subCategory, undefined)
  assert.deepEqual([params().get('category'), params().get('search'), params().get('sort'), params().get('fabric')],
    ['sarees', 'silk', 'price-asc', 'Silk'])
  assert.equal(lastList().search, 'silk')
  assert.equal(lastList().sort, 'price-asc')
  assert.ok(chips(container).includes('Sarees ×'))
  assert.equal(select(container, 'Category').value, 'sarees')

  await change(select(container, 'Category'), 'suit-pieces')
  assert.equal(lastList().canonicalCategory, 'suit-pieces')
  assert.ok(chips(container).includes('Suit Pieces ×'))
  assert.equal(chips(container).includes('Sarees ×'), false)
})

test('changing the category resets pagination', async () => {
  resetApi({ listResponse: { success: true, products: [product('p1')], pagination: { page: 2, pages: 3, total: 30 } } })
  const container = await render('/collection?page=2')
  assert.equal(lastList().page, 2)
  await change(select(container, 'Category'), 'kurtis')
  assert.equal(params().has('page'), false)
  assert.equal(lastList().page, 1)
  assert.equal(lastList().canonicalCategory, 'kurtis')
})

const URL_CASES = [
  // [route URL, canonicalCategory, subCategory, page title, chip]
  ['/category/sarees', 'sarees', undefined, 'Sarees', null],
  ['/category/cotton-sarees', 'sarees', 'Cotton Sarees', 'Cotton Sarees', 'Cotton Sarees ×'],
  ['/category/silk-sarees', 'sarees', 'Silk Sarees', 'Silk Sarees', 'Silk Sarees ×'],
  ['/category/suit-pieces', 'suit-pieces', undefined, 'Suit Pieces', null],
  ['/category/suit-pants', 'suit-pieces', 'Suit Pants', 'Suit Pants', 'Suit Pants ×']
]

for (const [url, canonical, subCategory, title, chip] of URL_CASES) {
  test(`route ${url} sends the parent and subcategory constraints and shows the right title`, async () => {
    resetApi()
    const container = await render(url)
    assert.equal(lastList().canonicalCategory, canonical)
    assert.equal(lastList().subCategory, subCategory)
    assert.equal(lastList().category, undefined)
    assert.equal(lastList().productType, undefined)
    assert.equal(text(container.querySelector('h1')), title)
    assert.deepEqual(chips(container), chip ? [chip] : [])
  })
}

test('legacy type slugs keep their original narrow productType filter and never widen to the parent', async () => {
  for (const [url, type, title] of [['/category/suits', 'suit', 'Suits'], ['/category/suit-sets', 'suit-set', 'Suit sets']]) {
    resetApi()
    const container = await render(url)
    assert.equal(lastList().productType, type, url)
    assert.equal(lastList().canonicalCategory, 'suit-pieces', url)
    assert.equal(lastList().subCategory, undefined, url)
    assert.equal(lastList().category, undefined, url)
    assert.equal(text(container.querySelector('h1')), title, url)
    assert.deepEqual(chips(container), [`${title} ×`], url)
    await click(chipButton(container, title))
    assert.equal(location.pathname, '/category/suit-pieces')
  }
})

test('equivalent legacy queries narrow the same way as the legacy type slugs', async () => {
  for (const [url, type] of [['/collection?productType=suit', 'suit'], ['/collection?productType=suit-set', 'suit-set']]) {
    resetApi()
    const container = await render(url)
    assert.equal(lastList().productType, type, url)
    assert.equal(lastList().canonicalCategory, undefined, url)
    assert.equal(select(container, 'Product type'), null)
  }
  resetApi()
  await render('/collection?category=suit-pieces&productType=suit')
  assert.equal(lastList().productType, 'suit')
  assert.equal(lastList().canonicalCategory, 'suit-pieces')
})

const QUERY_CASES = [
  ['/collection?category=Sarees', 'sarees', undefined, 'Sarees ×'],
  ['/collection?category=Cotton%20Sarees', 'sarees', 'Cotton Sarees', 'Cotton Sarees ×'],
  ['/collection?category=silk%20%20SAREES', 'sarees', 'Silk Sarees', 'Silk Sarees ×'],
  ['/collection?category=Suit%20Pieces', 'suit-pieces', undefined, 'Suit Pieces ×'],
  ['/collection?category=%20suit%20pants%20', 'suit-pieces', 'Suit Pants', 'Suit Pants ×']
]

for (const [url, canonical, subCategory, chip] of QUERY_CASES) {
  test(`legacy query ${url} resolves to the same constraints`, async () => {
    resetApi()
    const container = await render(url)
    assert.equal(lastList().canonicalCategory, canonical)
    assert.equal(lastList().subCategory, subCategory)
    assert.equal(lastList().category, undefined)
    assert.deepEqual(chips(container), [chip])
    assert.equal(select(container, 'Category').value, canonical)
  })
}

test('unknown legacy labels keep the exact-match filter and never become a category', async () => {
  resetApi()
  const container = await render('/collection?category=Dupatta')
  assert.equal(lastList().category, 'Dupatta')
  assert.equal(lastList().canonicalCategory, undefined)
  assert.equal(lastList().subCategory, undefined)
  assert.equal(select(container, 'Category').value, '')
  assert.deepEqual(chips(container), ['Dupatta ×'])
})

test('removing the subcategory chip on a category page returns to the parent category', async () => {
  resetApi()
  const container = await render('/category/cotton-sarees')
  await click(chipButton(container, 'Cotton Sarees'))
  assert.equal(location.pathname, '/category/sarees')
})

test('a legacy productType URL still filters, is shown as a removable chip, and has no dropdown', async () => {
  resetApi()
  const container = await render('/collection?productType=saree&search=red')
  assert.equal(lastList().productType, 'saree')
  assert.equal(select(container, 'Product type'), null)
  assert.ok(chips(container).includes('saree ×'))
  await click(chipButton(container, 'saree'))
  assert.equal(params().has('productType'), false)
  assert.equal(params().get('search'), 'red')
  assert.equal(lastList().productType, undefined)
})

test('removing a chip keeps the other filters; Clear resets every filter', async () => {
  resetApi()
  const container = await render('/collection?category=Silk%20Sarees&search=red&sort=price-desc&fabric=Silk&availableOnly=true')
  assert.deepEqual(chips(container).sort(),
    ['Search: red ×', 'Silk ×', 'Silk Sarees ×', 'In stock ×'].sort())
  await click(chipButton(container, 'Silk Sarees'))
  assert.equal(params().has('category'), false)
  assert.deepEqual([params().get('search'), params().get('sort'), params().get('fabric'), params().get('availableOnly')],
    ['red', 'price-desc', 'Silk', 'true'])
  assert.equal(lastList().canonicalCategory, undefined)
  assert.equal(lastList().subCategory, undefined)
  assert.equal(lastList().search, 'red')

  await click(clearButton(container))
  assert.equal(location.search, '')
  assert.deepEqual(chips(container), [])
  assert.equal(lastList().search, undefined)
  assert.equal(lastList().canonicalCategory, undefined)
  assert.equal(select(container, 'Category').value, '')
})

test('stock and sort controls keep the selected category', async () => {
  resetApi()
  const container = await render('/collection?category=kurtis')
  await change(container.querySelector('select[aria-label="Sort products"]'), 'price-asc')
  assert.equal(lastList().sort, 'price-asc')
  assert.equal(lastList().canonicalCategory, 'kurtis')
  await click(container.querySelector('.catalogue-stock-filter input'))
  assert.equal(lastList().availableOnly, 'true')
  assert.equal(lastList().canonicalCategory, 'kurtis')
  assert.equal(params().get('category'), 'kurtis')
})

test('shows a loading state, then products without duplicates', async () => {
  resetApi({ listDelay: 400 })
  const container = await render('/collection')
  assert.match(text(container), /Loading products…/)
  await settle(500)
  assert.equal(container.querySelectorAll('a[href*="/product/"]').length >= 2, true)
  assert.match(text(container), /2 products/)
  assert.doesNotMatch(text(container), /Loading products…/)
  const hrefs = [...container.querySelectorAll('a[href*="/product/"]')].map(el => el.getAttribute('href'))
  assert.equal(new Set(hrefs).size, hrefs.length)
})

test('shows the empty state and Clear filters restores the full list', async () => {
  resetApi({ listResponse: { success: true, products: [], pagination: { page: 1, pages: 0, total: 0 } } })
  const container = await render('/collection?category=Lehenga')
  assert.match(text(container), /No products found/)
  assert.equal(lastList().canonicalCategory, 'lehengas')
  api.listResponse = null
  await click([...container.querySelectorAll('button')].find(el => text(el) === 'Clear filters'))
  assert.equal(location.search, '')
  assert.doesNotMatch(text(container), /No products found/)
})

test('shows the API error state without crashing', async () => {
  resetApi({ listStatus: 500 })
  const container = await render('/category/sarees')
  assert.match(container.querySelector('[role="alert"]').textContent, /Catalogue exploded/)
  assert.equal(options(select(container, 'Fabric')).length > 0, true)
})
