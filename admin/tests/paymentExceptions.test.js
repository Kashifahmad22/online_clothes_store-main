import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anomalyActions,
  anomalyKindLabel,
  lastRunSummary,
  nextAnomalyStatuses,
  refundablePayments,
  reviewActions,
  seenAgainAfterResolution,
  stockDeductedLabel,
  summarizeRun,
  validateReason
} from '../src/utils/paymentExceptions.js'

test('review actions mirror the backend decision and carry its denial message', () => {
  const actions = reviewActions({
    release: { allowed: false, code: 'STOCK_UNAVAILABLE', message: 'Stock is unavailable.' },
    acknowledge: { allowed: true }
  })
  assert.deepEqual(actions.map(a => [a.action, a.enabled]), [['release', false], ['acknowledge', true]])
  assert.equal(actions[0].message, 'Stock is unavailable.')
  assert.equal(actions[1].message, '')
})

test('review actions are disabled when the backend reports nothing', () => {
  assert.equal(reviewActions(undefined).every(a => a.enabled === false), true)
  assert.equal(reviewActions({ release: { allowed: 'yes' } })[0].enabled, false)
})

test('no review action is a plain clear-hold button', () => {
  const labels = reviewActions({}).map(a => a.label.toLowerCase())
  assert.equal(labels.some(label => /^clear|remove hold|clear hold/.test(label)), false)
})

test('stock deducted label never guesses', () => {
  assert.equal(stockDeductedLabel({ stockDeducted: true }), 'Yes')
  assert.equal(stockDeductedLabel({ stockDeducted: false }), 'No')
  assert.equal(stockDeductedLabel({}), 'Unknown')
})

test('reasons need 5 to 120 characters after trimming', () => {
  assert.ok(validateReason('  ').error)
  assert.ok(validateReason('abcd').error)
  assert.ok(validateReason('x'.repeat(121)).error)
  assert.equal(validateReason('  checked ok ').reason, 'checked ok')
})

test('anomaly status moves follow the backend transition table', () => {
  assert.deepEqual(nextAnomalyStatuses('open'), ['investigating', 'resolved'])
  assert.deepEqual(nextAnomalyStatuses('resolved'), ['open'])
  assert.deepEqual(anomalyActions({ investigationStatus: 'investigating' }).map(a => a.status), ['open', 'resolved'])
  assert.deepEqual(anomalyActions({}).map(a => a.status), ['investigating', 'resolved'])
})

test('a resolved anomaly seen again is flagged', () => {
  const base = { investigationStatus: 'resolved', resolvedAt: '2025-01-02T00:00:00Z' }
  assert.equal(seenAgainAfterResolution({ ...base, lastSeenAt: '2025-01-03T00:00:00Z' }), true)
  assert.equal(seenAgainAfterResolution({ ...base, lastSeenAt: '2025-01-01T00:00:00Z' }), false)
  assert.equal(seenAgainAfterResolution({ investigationStatus: 'open', lastSeenAt: '2025-01-03T00:00:00Z' }), false)
})

test('anomaly kinds have readable labels with a safe fallback', () => {
  assert.match(anomalyKindLabel('captured_payment_mismatch'), /does not match/)
  assert.equal(anomalyKindLabel('some_new_kind'), 'some new kind')
})

test('refundable payments combine order accounting with linked anomaly payments without duplicates', () => {
  const order = { refundSummary: {}, paymentBalances: [
    { paymentId: 'pay_A', role: 'primary', remainingPaise: 1000 },
    { paymentId: 'pay_B', role: 'additional', remainingPaise: 500 }
  ] }
  const anomalies = [
    { kind: 'captured_payment_mismatch', paymentId: 'pay_B' },
    { kind: 'captured_payment_mismatch', paymentId: 'pay_C' },
    { kind: 'refund_mismatch', paymentId: 'pay_D' },
    { kind: 'captured_payment_mismatch', paymentId: '' }
  ]
  const rows = refundablePayments(order, anomalies)
  assert.deepEqual(rows.map(r => r.paymentId), ['pay_A', 'pay_B', 'pay_C'])
  assert.equal(rows[2].remainingPaise, null)
  assert.equal(rows[2].known, false)
})

test('reconciliation run summary reports counts, errors and rate limiting', () => {
  const s = summarizeRun({
    id: 'r1', status: 'partial', trigger: 'admin', examined: 7, rateLimited: true, abortReason: 'rate_limited',
    counts: { settled: 2, settled_on_hold: 1, mismatch: 1, needs_review: 1, duplicate_recorded: 1, timeout: 1, gateway_error: 1 }
  })
  assert.equal(s.examined, 7)
  assert.equal(s.settled, 3)
  assert.equal(s.mismatches, 1)
  assert.equal(s.needsReview, 3)
  assert.equal(s.gatewayErrors, 2)
  assert.equal(s.rateLimited, true)
  assert.equal(s.stoppedEarly, true)
  assert.equal(summarizeRun({}).examined, 0)
})

test('last run summary is the newest run or null', () => {
  assert.equal(lastRunSummary([]), null)
  assert.equal(lastRunSummary([{ id: 'new', status: 'completed' }, { id: 'old' }]).id, 'new')
})
