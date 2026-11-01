// Pure refund helpers for the admin Orders page. Amounts are integer paise; no floating-point rupee maths.

export const REFUND_STATUS_LABELS = Object.freeze({
  requested: 'Requested – not yet confirmed by Razorpay',
  pending: 'Pending – Razorpay is processing',
  processed: 'Processed',
  failed: 'Failed'
})

// "1,299.50" or "1299" -> paise, or null when the text is not a valid positive amount with at most 2 decimals.
export const rupeesToPaise = text => {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(text ?? '').trim().replace(/,/g, ''))
  if (!match) return null
  const paise = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0)
  return paise > 0 ? paise : null
}

export const formatPaise = paise => `₹${Math.floor(paise / 100).toLocaleString('en-IN')}.${String(paise % 100).padStart(2, '0')}`

export const validateRefundForm = ({ amountText, reason }, remainingPaise) => {
  const paise = rupeesToPaise(amountText)
  if (paise === null) return { error: 'Enter a refund amount in rupees, with up to 2 decimals.' }
  if (paise > remainingPaise) return { error: `Only ${formatPaise(remainingPaise)} can still be refunded.` }
  const trimmed = String(reason ?? '').trim()
  if (trimmed.length < 5 || trimmed.length > 120) return { error: 'Enter a reason of 5 to 120 characters.' }
  return { paise, reason: trimmed }
}

export const canShowRefundForm = order =>
  order.paymentMethod === 'Razorpay' && order.paymentStatus === 'paid' && (order.refundSummary?.remainingPaise || 0) > 0

export const hasInFlightRefund = order =>
  (order.refunds || []).some(refund => ['requested', 'pending'].includes(refund.status))

export const refundIdempotencyKey = () => crypto.randomUUID()
