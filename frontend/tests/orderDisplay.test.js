import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addressLines, formatInr, formatOrderDate, formatOrderReference, fulfilmentLabel, orderLines, orderTotals,
  paymentMethodLabel, paymentStatusLabel
} from '../src/utils/orderDisplay.js'

test('order reference is friendly, derived from the id and matches the backend formula', () => {
  assert.equal(formatOrderReference({ _id: '64b7f3c2a1d4e5f601234abc' }), 'PSH-E5F601234ABC')
  assert.equal(formatOrderReference({ _id: '64b7f3c2a1d4e5f601234abc', orderReference: 'PSH-E5F601234ABC' }), 'PSH-E5F601234ABC')
  assert.equal(formatOrderReference({ _id: '64b7f3c2a1d4e5f601234abc', orderReference: 'PSH-01234ABC' }), 'PSH-E5F601234ABC')
  assert.equal(formatOrderReference({ _id: '64b7f3c2a1d4e5f601234abc' }).length, 16)
  assert.equal(formatOrderReference({ _id: 'abc123' }), '')
  assert.equal(formatOrderReference(null), '')
  assert.notEqual(formatOrderReference({ _id: '64b7f3c2a1d4e5f601234abc' }), '64b7f3c2a1d4e5f601234abc')
})

test('INR formatting uses integer paise', () => {
  assert.equal(formatInr(129900), '₹1,299')
  assert.equal(formatInr(129950), '₹1,299.50')
  assert.equal(formatInr(0), '₹0')
  assert.equal(formatInr(NaN), '')
})

test('payment and fulfilment states read as plain language, never raw enum values', () => {
  const cod = { paymentMethod: 'COD', paymentStatus: 'cod_pending', status: 'Order Placed' }
  assert.equal(paymentMethodLabel(cod), 'Cash on delivery')
  assert.match(paymentStatusLabel(cod), /pay when your order arrives/i)
  assert.doesNotMatch(paymentStatusLabel(cod), /cod_pending/)
  assert.equal(fulfilmentLabel(cod), 'Order Placed')
  assert.equal(paymentStatusLabel({ paymentStatus: 'paid' }), 'Paid')
  assert.equal(paymentStatusLabel({ payment: true }), 'Paid')
  assert.equal(paymentStatusLabel({}), '')
  assert.equal(fulfilmentLabel({ paymentMethod: 'Razorpay', paymentStatus: 'pending', status: 'Order Placed' }), 'Awaiting payment')
  assert.equal(fulfilmentLabel({ paymentMethod: 'Razorpay', paymentStatus: 'paid', status: 'Packed' }), 'Packed')
})

test('totals use recorded paise and hide shipping for legacy orders instead of inventing it', () => {
  assert.deepEqual(orderTotals({ subtotalPaise: 100000, shippingPaise: 5000, totalPaise: 105000 }),
    { subtotalPaise: 100000, shippingPaise: 5000, totalPaise: 105000 })
  assert.deepEqual(orderTotals({ amount: 1050 }), { subtotalPaise: null, shippingPaise: null, totalPaise: 105000 })
  assert.deepEqual(orderTotals({}), { subtotalPaise: null, shippingPaise: null, totalPaise: null })
})

test('order lines compute line totals from recorded unit price and quantity only', () => {
  const [line, broken] = orderLines({ items: [{ name: 'A', price: 1299.5, quantity: 2 }, { name: 'B' }] })
  assert.equal(line.lineTotalPaise, 259900)
  assert.equal(broken.lineTotalPaise, null)
})

test('dates and addresses are formatted without placeholders', () => {
  assert.match(formatOrderDate({ date: Date.UTC(2025, 0, 15, 12) }), /15 Jan 2025/)
  assert.equal(formatOrderDate({}), '')
  assert.equal(formatOrderDate({ date: 'x' }), '')
  assert.deepEqual(addressLines({ firstName: 'Asha', lastName: 'Rao', street: '1 MG Road', city: 'Patna', state: 'Bihar', zipcode: '800001', country: 'India', phone: '9876543210', email: 'a@b.c' }),
    ['Asha Rao', '1 MG Road', 'Patna, Bihar, 800001', 'India', 'Phone: 9876543210'])
  assert.deepEqual(addressLines(null), [])
})
