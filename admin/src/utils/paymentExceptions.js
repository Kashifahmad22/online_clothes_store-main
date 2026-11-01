// Pure view-model helpers for the payment exception screens. The backend stays authoritative: these helpers only
// describe what it reported and never decide that a hold may be cleared or a payment is refunded.

export const ANOMALY_STATUS_LABELS = Object.freeze({
  open: 'Open',
  investigating: 'Under investigation',
  resolved: 'Resolved'
})

const TRANSITIONS = Object.freeze({
  open: ['investigating', 'resolved'],
  investigating: ['open', 'resolved'],
  resolved: ['open']
})

export const nextAnomalyStatuses = status => TRANSITIONS[status] || TRANSITIONS.open

export const ANOMALY_KIND_LABELS = Object.freeze({
  captured_payment_mismatch: 'Captured payment does not match the order',
  refund_unknown_order: 'Refund event not linked to any recorded refund',
  refund_mismatch: 'Refund event does not match the recorded refund'
})

export const anomalyKindLabel = kind => ANOMALY_KIND_LABELS[kind] || String(kind || 'Unknown').replace(/_/g, ' ')

export const validateReason = reason => {
  const trimmed = String(reason ?? '').trim()
  if (trimmed.length < 5 || trimmed.length > 120) return { error: 'Enter a reason of 5 to 120 characters.' }
  return { reason: trimmed }
}

export const anomalyActions = anomaly =>
  nextAnomalyStatuses(anomaly?.investigationStatus || 'open').map(status => ({
    status,
    label: status === 'resolved' ? 'Mark resolved' : status === 'investigating' ? 'Start investigation' : 'Reopen'
  }))

// "Seen again" flags a resolved anomaly whose evidence was recorded again after it was closed.
export const seenAgainAfterResolution = anomaly =>
  anomaly?.investigationStatus === 'resolved' && Boolean(anomaly.resolvedAt) && Boolean(anomaly.lastSeenAt) &&
  new Date(anomaly.lastSeenAt) > new Date(anomaly.resolvedAt)

export const REVIEW_ACTION_LABELS = Object.freeze({
  release: 'Re-reserve stock and release for fulfilment',
  acknowledge: 'Acknowledge review (no stock change)'
})

// Only actions the backend reports as allowed are enabled; denied ones carry the server's explanation.
export const reviewActions = review => ['release', 'acknowledge'].map(action => {
  const decision = review?.[action] || { allowed: false, message: 'Not available.' }
  return {
    action,
    label: REVIEW_ACTION_LABELS[action],
    enabled: decision.allowed === true,
    message: decision.allowed === true ? '' : decision.message || 'Not available.'
  }
})

export const stockDeductedLabel = review => review?.stockDeducted === true ? 'Yes' : review?.stockDeducted === false ? 'No' : 'Unknown'

// Payments that can be refunded individually: every one the order accounts for, plus gateway captures the
// anomaly log linked to it (these exist only in the log until an admin refunds them).
export const refundablePayments = (order, anomalies = []) => {
  const rows = new Map()
  for (const balance of order?.paymentBalances || order?.refundSummary?.paymentBalances || []) {
    rows.set(balance.paymentId, { paymentId: balance.paymentId, role: balance.role, remainingPaise: balance.remainingPaise, known: true })
  }
  for (const anomaly of anomalies) {
    if (!anomaly.paymentId || rows.has(anomaly.paymentId)) continue
    if (!['captured_payment_mismatch', 'duplicate_captured_payment'].includes(anomaly.kind)) continue
    rows.set(anomaly.paymentId, { paymentId: anomaly.paymentId, role: 'additional', remainingPaise: null, known: false })
  }
  return [...rows.values()]
}

const count = (counts, ...names) => names.reduce((sum, name) => sum + (Number(counts?.[name]) || 0), 0)

// Counter names mirror the reconciliation service's outcomes.
export const summarizeRun = run => {
  const counts = run?.counts || {}
  return {
    id: run?.id,
    startedAt: run?.startedAt,
    trigger: run?.trigger || 'unknown',
    outcome: run?.status || 'unknown',
    examined: run?.examined || 0,
    settled: count(counts, 'settled', 'settled_on_hold'),
    mismatches: count(counts, 'mismatch'),
    needsReview: count(counts, 'needs_review', 'settled_on_hold', 'duplicate_recorded'),
    gatewayErrors: count(counts, 'gateway_error', 'timeout', 'error', 'incomplete_evidence'),
    rateLimited: Boolean(run?.rateLimited),
    stoppedEarly: Boolean(run?.abortReason),
    abortReason: run?.abortReason || ''
  }
}

export const lastRunSummary = runs => (runs && runs.length > 0 ? summarizeRun(runs[0]) : null)
