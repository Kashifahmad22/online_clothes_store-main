const STORAGE_KEY = 'psh.pendingCheckout'
const UUID = /^[0-9a-f-]{16,64}$/i
const OBJECT_ID = /^[0-9a-f]{24}$/i

// Only opaque identifiers are stored; the server stays authoritative for status and amounts.
export const readPendingCheckout = () => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    return {
      idempotencyKey: UUID.test(parsed.idempotencyKey || '') ? parsed.idempotencyKey : null,
      orderId: OBJECT_ID.test(parsed.orderId || '') ? parsed.orderId : null
    }
  } catch {
    return null
  }
}

export const savePendingCheckout = ({ idempotencyKey, orderId }) => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ idempotencyKey, orderId: orderId || null }))
  } catch {
    // Storage can be unavailable; recovery then falls back to the orders page.
  }
}

export const clearPendingCheckout = () => {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

// Mirrors the backend payable gate for a pending reservation; the retry endpoint re-checks it.
export const isRecoverableOrder = (order, now = new Date()) =>
  Boolean(order) && order.paymentMethod === 'Razorpay' && order.paymentStatus === 'pending' &&
  order.status === 'Order Placed' && !order.fulfillmentHold && !order.paymentIssue &&
  Boolean(order.reservationHeld) && new Date(order.reservationExpiresAt) > now
