import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GUEST_CART_STORAGE_KEY, clearGuestCart, loadGuestCart, mergeCarts, reconcileGuestCart, sanitiseCart, saveGuestCart
} from '../src/utils/guestCart.js'

const memoryStorage = (initial = {}) => {
  const data = { ...initial }
  return {
    data,
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value) },
    removeItem: key => { delete data[key] }
  }
}
const product = (id, variants) => ({ _id: id, variants: variants.map(_id => ({ _id })) })

test('guest cart survives a refresh with product and variant identity and quantities intact', () => {
  const storage = memoryStorage()
  saveGuestCart({ p1: { v1: 2, v2: 1 }, p2: { v3: 4 } }, storage)
  assert.deepEqual(loadGuestCart(storage), { p1: { v1: 2, v2: 1 }, p2: { v3: 4 } })
})

test('persisted cart stores only ids and quantities, never prices or stock', () => {
  const storage = memoryStorage()
  saveGuestCart({ p1: { v1: 2 } }, storage)
  const raw = storage.data[GUEST_CART_STORAGE_KEY]
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['items', 'version'])
  assert.doesNotMatch(raw, /price|stock|token|address|email/i)
  assert.deepEqual(JSON.parse(raw).items, { p1: { v1: 2 } })
})

test('empty cart removes the stored key', () => {
  const storage = memoryStorage()
  saveGuestCart({ p1: { v1: 1 } }, storage)
  saveGuestCart({}, storage)
  assert.equal(GUEST_CART_STORAGE_KEY in storage.data, false)
  saveGuestCart({ p1: { v1: 1 } }, storage)
  clearGuestCart(storage)
  assert.deepEqual(loadGuestCart(storage), {})
})

test('malformed or hostile stored data yields an empty or sanitised cart without throwing', () => {
  for (const raw of ['not json', '{', 'null', '[]', '"x"', '{"version":2,"items":{"p1":{"v1":1}}}', '{"version":1,"items":[1]}']) {
    assert.deepEqual(loadGuestCart(memoryStorage({ [GUEST_CART_STORAGE_KEY]: raw })), {}, raw)
  }
  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.deepEqual(loadGuestCart(throwing), {})
  assert.doesNotThrow(() => saveGuestCart({ p1: { v1: 1 } }, throwing))

  const cleaned = sanitiseCart({
    p1: { v1: 2, v2: 0, v3: -1, v4: 1.5, v5: '3', v6: Number.MAX_SAFE_INTEGER + 10, v7: 500 },
    '__proto__': { v1: 1 },
    constructor: { v1: 1 },
    'bad id!': { v1: 1 },
    p2: 'nope'
  })
  assert.deepEqual(cleaned, { p1: { v1: 2, v7: 99 } })
  assert.equal(Object.getPrototypeOf(cleaned), Object.prototype)
})

test('reconcile drops unavailable products and variants but keeps valid lines', () => {
  const catalogue = [product('p1', ['v1', 'v2']), product('p2', ['v3'])]
  const { cart, removed } = reconcileGuestCart({ p1: { v1: 2, vGone: 1 }, pGone: { v9: 1 }, p2: { v3: 3 } }, catalogue)
  assert.deepEqual(cart, { p1: { v1: 2 }, p2: { v3: 3 } })
  assert.equal(removed, 2)
})

test('a variant that was replaced is removed, never silently mapped to another variant', () => {
  const { cart, removed } = reconcileGuestCart({ p1: { vOld: 2 } }, [product('p1', ['vNew'])])
  assert.deepEqual(cart, {})
  assert.equal(removed, 1)
})

test('guest-to-login merge sums each variant once and does not duplicate lines', () => {
  const { merged, lines } = mergeCarts({ p1: { v1: 2 } }, { p1: { v1: 1, v2: 3 }, p2: { v3: 1 } })
  assert.deepEqual(merged, { p1: { v1: 3, v2: 3 }, p2: { v3: 1 } })
  assert.equal(lines.length, 3)
  assert.deepEqual(lines.find(line => line.variantId === 'v1'), { productId: 'p1', variantId: 'v1', quantity: 3, serverQuantity: 2 })
})

test('merge is capped by stock and by the maximum quantity, and reports lines that cannot be added', () => {
  const limitFor = (productId, variantId) => (variantId === 'v1' ? 4 : variantId === 'v2' ? 0 : null)
  const { merged, dropped } = mergeCarts({ p1: { v1: 3, v2: 0 } }, { p1: { v1: 5, v2: 1 }, p3: { v9: 98 } }, limitFor)
  assert.equal(merged.p1.v1, 4)
  assert.equal(merged.p1.v2, undefined)
  assert.equal(merged.p3.v9, 98)
  assert.ok(dropped.some(line => line.variantId === 'v2'))
  const big = mergeCarts({ p9: { v1: 90 } }, { p9: { v1: 50 } })
  assert.equal(big.merged.p9.v1, 99)
})

test('merging an empty guest cart leaves the server cart untouched and requests no updates', () => {
  const { merged, lines } = mergeCarts({ p1: { v1: 2 } }, {})
  assert.deepEqual(merged, { p1: { v1: 2 } })
  assert.equal(lines.length, 0)
})
