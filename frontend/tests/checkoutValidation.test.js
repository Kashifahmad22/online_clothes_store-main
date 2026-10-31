import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCheckoutAddress } from '../src/utils/checkoutValidation.js'

const valid = {
  firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', street: '12 Main Road',
  city: 'Patna', state: 'Bihar', zipcode: '800001', phone: '9876543210'
}

test('a complete address passes', () => {
  assert.deepEqual(validateCheckoutAddress(valid), {})
  assert.deepEqual(validateCheckoutAddress({ ...valid, phone: '+91 98765-43210' }), {})
})

test('missing and whitespace-only fields are reported', () => {
  const errors = validateCheckoutAddress({ ...valid, firstName: '   ', city: '' })
  assert.ok(errors.firstName)
  assert.ok(errors.city)
  assert.equal(errors.email, undefined)
})

test('email, PIN code and mobile formats are checked', () => {
  assert.ok(validateCheckoutAddress({ ...valid, email: 'not-an-email' }).email)
  assert.ok(validateCheckoutAddress({ ...valid, zipcode: '80001' }).zipcode)
  assert.ok(validateCheckoutAddress({ ...valid, zipcode: '80000a' }).zipcode)
  assert.ok(validateCheckoutAddress({ ...valid, phone: '1234567890' }).phone)
  assert.ok(validateCheckoutAddress({ ...valid, phone: '98765' }).phone)
})

test('a missing address object reports every required field', () => {
  assert.equal(Object.keys(validateCheckoutAddress(undefined)).length, 8)
})
