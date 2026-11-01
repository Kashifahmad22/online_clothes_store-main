import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getMerchandisingBadges, MERCHANDISING_BADGE_LABELS } from '../src/utils/productDisplay.js'

const stocked = extra => ({ variants: [{ active: true, stockOnHand: 10, reserved: 0 }], ...extra })
const src = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('a product with no flags has no badge', () => {
  assert.deepEqual(getMerchandisingBadges(stocked({})), [])
  assert.deepEqual(getMerchandisingBadges(null), [])
})

test('each badge appears only when the backend or admin enabled it', () => {
  assert.deepEqual(getMerchandisingBadges(stocked({ lowStock: true })), ['low-stock'])
  assert.deepEqual(getMerchandisingBadges(stocked({ fastSelling: true })), ['fast-selling'])
  assert.deepEqual(getMerchandisingBadges(stocked({ bestseller: true })), ['best-seller'])
  assert.deepEqual(getMerchandisingBadges(stocked({ bestseller: false, fastSelling: false, lowStock: false })), [])
  assert.deepEqual(getMerchandisingBadges(stocked({ lowStock: 'yes', bestseller: 1 })), [])
})

test('a low-stock product can also carry the admin badge, but never two admin badges', () => {
  assert.deepEqual(getMerchandisingBadges(stocked({ bestseller: true, lowStock: true })), ['best-seller', 'low-stock'])
  assert.deepEqual(getMerchandisingBadges(stocked({ bestseller: true, fastSelling: true })), ['best-seller'])
})

test('unavailable products never show any badge', () => {
  const flags = { bestseller: true, lowStock: true }
  assert.deepEqual(getMerchandisingBadges({ variants: [{ active: true, stockOnHand: 0, reserved: 0 }], ...flags }), [])
  assert.deepEqual(getMerchandisingBadges({ variants: [{ active: false, stockOnHand: 5, reserved: 0 }], ...flags }), [])
  assert.deepEqual(getMerchandisingBadges({ variants: [], ...flags }), [])
  assert.deepEqual(getMerchandisingBadges(flags), [])
})

test('badge labels are readable text', () => {
  assert.deepEqual(Object.values(MERCHANDISING_BADGE_LABELS), ['Best Seller', 'Fast Selling', 'Low Stock'])
})

test('cards (home, collection, related) and the product page share one badge component', () => {
  assert.match(src('../src/components/ProductItem.jsx'), /<MerchandisingBadges product=\{product\}/)
  assert.match(src('../src/pages/Product.jsx'), /<MerchandisingBadges product=\{product\} \/>/)
})

test('customer-facing pages never render an exact stock count', () => {
  const product = src('../src/pages/Product.jsx')
  const cart = src('../src/pages/Cart.jsx')
  assert.doesNotMatch(product, /availableQuantity/)
  assert.doesNotMatch(product, /\$\{remaining\}/)
  assert.doesNotMatch(cart, /Only \{maxQuantity\}|Reduce to \{maxQuantity\}/)
  assert.match(product, /'In stock'/)
})
