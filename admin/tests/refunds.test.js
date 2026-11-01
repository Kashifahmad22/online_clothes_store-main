import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canShowRefundForm,
  formatPaise,
  hasInFlightRefund,
  rupeesToPaise,
  validateRefundForm
} from '../src/utils/refunds.js'

test('rupees convert to integer paise without floating-point drift', () => {
  assert.equal(rupeesToPaise('1299'), 129900)
  assert.equal(rupeesToPaise('1,299.5'), 129950)
  assert.equal(rupeesToPaise('0.07'), 7)
  assert.equal(rupeesToPaise('19.99'), 1999)
  for (const bad of ['', '0', '0.00', '-5', '1.234', 'abc', '1e3', '12.', null, undefined]) {
    assert.equal(rupeesToPaise(bad), null, String(bad))
  }
})

test('the refund form rejects amounts above the remaining balance and short reasons', () => {
  assert.equal(validateRefundForm({ amountText: '100', reason: 'Customer returned item' }, 10000).paise, 10000)
  assert.match(validateRefundForm({ amountText: '100.01', reason: 'Customer returned item' }, 10000).error, /Only ₹100\.00/)
  assert.match(validateRefundForm({ amountText: '10', reason: 'no' }, 10000).error, /reason/)
})

test('the refund form is offered only for paid Razorpay orders with a balance', () => {
  const base = { paymentMethod: 'Razorpay', paymentStatus: 'paid', refundSummary: { remainingPaise: 500 } }
  assert.equal(canShowRefundForm(base), true)
  assert.equal(canShowRefundForm({ ...base, paymentStatus: 'refunded' }), false)
  assert.equal(canShowRefundForm({ ...base, paymentMethod: 'COD' }), false)
  assert.equal(canShowRefundForm({ ...base, refundSummary: { remainingPaise: 0 } }), false)
})

test('in-flight refunds are detected and paise format as rupees', () => {
  assert.equal(hasInFlightRefund({ refunds: [{ status: 'processed' }, { status: 'pending' }] }), true)
  assert.equal(hasInFlightRefund({ refunds: [{ status: 'failed' }] }), false)
  assert.equal(formatPaise(250005), '₹2,500.05')
})
