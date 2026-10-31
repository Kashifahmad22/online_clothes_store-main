import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { storefrontNavigation, isUpcomingStorefrontCategory } from '../src/config/productCategories.js'

const navbar = readFileSync(new URL('../src/components/Navbar.jsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8')
const footer = readFileSync(new URL('../src/components/Footer.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const categoryPage = readFileSync(new URL('../src/pages/CategoryPage.jsx', import.meta.url), 'utf8')

test('direct category URLs: upcoming slugs show Coming soon, sarees and live categories do not', () => {
  const saree = [{ _id: '1', productType: 'saree' }]
  for (const slug of ['suit-pieces', 'lehengas', 'kurtis']) assert.equal(isUpcomingStorefrontCategory(slug, saree), true)
  assert.equal(isUpcomingStorefrontCategory('sarees', []), false)
  assert.equal(isUpcomingStorefrontCategory('lehengas', [...saree, { _id: '2', productType: 'lehenga' }]), false)
  assert.equal(isUpcomingStorefrontCategory('dresses', saree), false)
})

test('category route uses CategoryPage and the footer reuses shared navigation', () => {
  assert.match(app, /path='\/category\/:categorySlug' element=\{<CategoryPage \/>\}/)
  assert.match(categoryPage, /Coming soon/)
  assert.match(footer, /storefrontNavigation/)
  assert.match(footer, /status === 'upcoming'/)
})

const statuses = products => Object.fromEntries(storefrontNavigation(products).map(c => [c.slug, c.status]))

test('shows the four categories in order even before products load', () => {
  const nav = storefrontNavigation([])
  assert.deepEqual(nav.map(c => c.label), ['Sarees', 'Suit Pieces', 'Lehengas', 'Kurtis'])
  assert.deepEqual(statuses([]), { sarees: 'available', 'suit-pieces': 'upcoming', lehengas: 'upcoming', kurtis: 'upcoming' })
})

test('upcoming categories carry no product, so no counts, prices or images can be shown', () => {
  for (const category of storefrontNavigation([{ _id: '1', productType: 'saree' }]).filter(c => c.status === 'upcoming')) {
    assert.equal(category.product, null)
  }
})

test('a category becomes shoppable only when a live product exists for it', () => {
  const products = [
    { _id: '1', productType: 'saree' },
    { _id: '2', productType: 'lehenga' },
    { _id: '3', productType: 'other', category: 'Kurtis' }
  ]
  assert.deepEqual(statuses(products), { sarees: 'available', 'suit-pieces': 'upcoming', lehengas: 'available', kurtis: 'available' })
})

test('other live categories are appended after the four featured ones', () => {
  const nav = storefrontNavigation([{ _id: '1', productType: 'saree' }, { _id: '2', productType: 'dress' }])
  assert.deepEqual(nav.map(c => c.slug), ['sarees', 'suit-pieces', 'lehengas', 'kurtis', 'dresses'])
  assert.equal(nav[4].status, 'available')
})

test('navigation renders upcoming items as non-links with a Coming soon label', () => {
  assert.equal((navbar.match(/category\.status === 'upcoming'/g) || []).length, 2)
  assert.equal((navbar.match(/Coming soon/g) || []).length, 2)
  assert.doesNotMatch(navbar, /to=\{`\/category\/\$\{category\.slug\}`\}[^>]*upcoming/)
})

test('homepage renders upcoming categories as non-links without a Shop now action', () => {
  const upcomingBranch = home.slice(home.indexOf("status === 'upcoming'"), home.indexOf('const image = product'))
  assert.match(upcomingBranch, /Coming soon/)
  assert.doesNotMatch(upcomingBranch, /<Link|Shop now/)
  assert.match(home, /Shop now/)
})
