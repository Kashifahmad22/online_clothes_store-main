const REFERENCE_PATTERN = /^[0-9a-f]{12,}$/i

// Same derivation as the backend serializer (backend/utils/orderSerializers.js orderReference): PSH- plus the last
// 12 characters of the id. A server value in any other shape (e.g. an older 8-character one) is ignored.
export const formatOrderReference = order => {
  if (typeof order?.orderReference === 'string' && /^PSH-[0-9A-F]{12}$/.test(order.orderReference)) return order.orderReference
  const id = String(order?._id ?? '')
  return REFERENCE_PATTERN.test(id) ? `PSH-${id.slice(-12).toUpperCase()}` : ''
}

export const formatInr = paise =>
  Number.isFinite(paise) ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}` : ''

export const formatOrderDate = order => {
  const raw = Number.isFinite(Number(order?.date)) && Number(order.date) > 0 ? Number(order.date) : order?.createdAt
  const date = raw ? new Date(raw) : null
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : ''
}

const PAYMENT_LABELS = {
  cod_pending: 'Cash on delivery – pay when your order arrives',
  pending: 'Awaiting payment',
  authorized: 'Payment authorised',
  paid: 'Paid',
  failed: 'Payment failed',
  expired: 'Payment window expired',
  refunded: 'Refunded'
}

export const paymentMethodLabel = order =>
  order?.paymentMethod === 'COD' ? 'Cash on delivery' : order?.paymentMethod === 'Razorpay' ? 'Online payment' : ''

export const paymentStatusLabel = order => {
  const status = order?.paymentStatus
  if (status && PAYMENT_LABELS[status]) return PAYMENT_LABELS[status]
  return order?.payment ? PAYMENT_LABELS.paid : ''
}

// An unpaid online order has not entered fulfilment, so its status is the payment state rather than "Order Placed".
export const fulfilmentLabel = order => {
  if (order?.paymentMethod === 'Razorpay' && ['pending', 'failed', 'expired'].includes(order.paymentStatus)) {
    return order.paymentStatus === 'pending' ? 'Awaiting payment' : 'Not confirmed'
  }
  return order?.status || ''
}

export const orderLines = order =>
  (order?.items || []).map(item => {
    const unitPaise = Number.isFinite(Number(item.price)) ? Math.round(Number(item.price) * 100) : null
    const quantity = Number.isSafeInteger(item.quantity) ? item.quantity : null
    return {
      ...item,
      unitPaise,
      quantity,
      lineTotalPaise: unitPaise !== null && quantity !== null ? unitPaise * quantity : null
    }
  })

// Shipping is only shown when the order recorded it; legacy orders without it show just the total.
export const orderTotals = order => {
  const hasBreakdown = Number.isSafeInteger(order?.subtotalPaise) && Number.isSafeInteger(order?.shippingPaise)
  const totalPaise = Number.isSafeInteger(order?.totalPaise)
    ? order.totalPaise
    : Number.isFinite(Number(order?.amount)) ? Math.round(Number(order.amount) * 100) : null
  return {
    subtotalPaise: hasBreakdown ? order.subtotalPaise : null,
    shippingPaise: hasBreakdown ? order.shippingPaise : null,
    totalPaise
  }
}

export const addressLines = address => {
  if (!address || typeof address !== 'object') return []
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ')
  const region = [address.city, address.state, address.zipcode].filter(Boolean).join(', ')
  return [name, address.street, region, address.country, address.phone ? `Phone: ${address.phone}` : '']
    .filter(value => typeof value === 'string' && value.trim())
}
