import assert from 'node:assert/strict'
import test from 'node:test'
import { remainingQuantity, validatePurchaseQuantity } from '../src/utils/productDisplay.js'

const variant = (stockOnHand, reserved = 0, active = true) => ({ stockOnHand, reserved, active })

test('remaining quantity subtracts reserved stock and the cart contents', () => {
  assert.equal(remainingQuantity(variant(10, 3), 0), 7)
  assert.equal(remainingQuantity(variant(10, 3), 5), 2)
  assert.equal(remainingQuantity(variant(10, 3), 20), 0)
})

test('inactive or sold-out variants have nothing remaining', () => {
  assert.equal(remainingQuantity(variant(5, 0, false), 0), 0)
  assert.equal(remainingQuantity(variant(2, 2), 0), 0)
  assert.equal(remainingQuantity(undefined, 0), 0)
})

test('valid whole-number quantities within the remaining stock are accepted as typed', () => {
  assert.deepEqual(validatePurchaseQuantity('1', variant(3), 0), { valid: true, quantity: 1, error: '' })
  assert.equal(validatePurchaseQuantity(3, variant(3), 0).quantity, 3)
  assert.equal(validatePurchaseQuantity(' 2 ', variant(5), 3).quantity, 2)
})

test('combined cart quantity can never exceed available stock', () => {
  assert.equal(validatePurchaseQuantity('2', variant(3), 2).valid, false)
  assert.equal(validatePurchaseQuantity('1', variant(3), 2).valid, true)
  assert.equal(validatePurchaseQuantity('1', variant(3), 3).valid, false)
  assert.equal(validatePurchaseQuantity('1', variant(10, 4), 6).valid, false)
})

test('zero, negative, fractional, empty and non-numeric values are rejected, never adjusted', () => {
  for (const raw of ['0', '-4', '1.5', '2.9', '', '  ', 'abc', '1e2', '+2', NaN, Infinity, null, undefined]) {
    const result = validatePurchaseQuantity(raw, variant(5), 0)
    assert.equal(result.valid, false, `expected ${String(raw)} to be rejected`)
    assert.equal(result.quantity, 0)
    assert.ok(result.error)
  }
})

test('above-stock values are rejected without revealing the stock count', () => {
  const result = validatePurchaseQuantity('99', variant(3), 1)
  assert.equal(result.valid, false)
  assert.doesNotMatch(result.error, /\d/)
  assert.match(result.error, /already in your cart/)
  assert.doesNotMatch(validatePurchaseQuantity('99', variant(3), 0).error, /\d/)
})

test('unavailable variants and a maxed cart reject any quantity', () => {
  assert.equal(validatePurchaseQuantity('1', variant(5, 0, false), 0).valid, false)
  assert.equal(validatePurchaseQuantity('1', variant(0), 0).valid, false)
  assert.equal(validatePurchaseQuantity('1', undefined, 0).valid, false)
})
