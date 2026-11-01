import { useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { toast } from 'react-toastify'
import { backendUrl } from '../App'
import { formatPaise, refundIdempotencyKey, rupeesToPaise } from '../utils/refunds'
import {
  anomalyKindLabel,
  refundablePayments,
  reviewActions,
  stockDeductedLabel,
  validateReason
} from '../utils/paymentExceptions'

const when = value => value ? new Date(value).toLocaleString('en-IN') : ''

// Resolution is limited to the actions the backend reports as allowed, each with a mandatory reason.
const PaymentReviewPanel = ({ order, token, onChanged }) => {
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState('')
  const [reason, setReason] = useState('')
  const [refundPaymentId, setRefundPaymentId] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [refundKey, setRefundKey] = useState(refundIdempotencyKey)

  const post = async (path, body) => (await axios.post(`${backendUrl}/api/order/${path}`, body, { headers: { token } })).data

  const load = async () => {
    setBusy('load')
    try {
      const data = await post('payment-review/detail', { orderId: order._id })
      setDetail(data)
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load the payment review.')
    } finally {
      setBusy('')
    }
  }

  const resolve = async action => {
    if (busy) return
    const checked = validateReason(reason)
    if (checked.error) { toast.error(checked.error); return }
    setBusy(action)
    try {
      const data = await post('payment-review', { orderId: order._id, action, reason: checked.reason })
      toast.success(data.message || 'Payment review recorded.')
      setReason('')
      await onChanged()
      setDetail(null)
    } catch (error) {
      toast.error(error.response?.data?.message || 'The review could not be resolved.')
      await load()
    } finally {
      setBusy('')
    }
  }

  const payments = detail ? refundablePayments(order, detail.anomalies) : []
  const selected = payments.find(payment => payment.paymentId === refundPaymentId)

  const refund = async event => {
    event.preventDefault()
    if (busy) return
    const paise = rupeesToPaise(refundAmount)
    const checked = validateReason(refundReason)
    if (!selected) { toast.error('Choose the payment to refund.'); return }
    if (paise === null) { toast.error('Enter a refund amount in rupees, with up to 2 decimals.'); return }
    if (selected.remainingPaise !== null && paise > selected.remainingPaise) {
      toast.error(`Only ${formatPaise(selected.remainingPaise)} can still be refunded for this payment.`); return
    }
    if (checked.error) { toast.error(checked.error); return }
    setBusy('refund')
    try {
      const data = await post('refund', {
        orderId: order._id, paymentId: selected.paymentId, amountPaise: paise,
        reason: checked.reason, idempotencyKey: refundKey
      })
      toast.info(data.message || 'Refund submitted.')
      setRefundAmount(''); setRefundReason(''); setRefundKey(refundIdempotencyKey())
    } catch (error) {
      const status = error.response?.status
      if (status && status < 500) setRefundKey(refundIdempotencyKey())
      toast.error(error.response?.data?.message || 'Refund request failed.')
    } finally {
      setBusy('')
      await onChanged()
      await load()
    }
  }

  return (
    <div className='col-span-full border-t pt-4' aria-label='Payment review'>
      <p className='font-medium'>Payment review</p>
      {!detail && (
        <button type='button' onClick={load} disabled={Boolean(busy)} className='mt-2 min-h-10 border px-4 py-2 disabled:opacity-50'>
          {busy === 'load' ? 'Loading…' : 'Open review details'}
        </button>
      )}
      {detail && (
        <div className='mt-2 grid gap-3'>
          <ul className='grid gap-1'>
            <li>Order reference : {order.orderReference || order._id}</li>
            <li>Customer : {order.address?.firstName} {order.address?.lastName} · {order.address?.phone}{order.address?.email ? ` · ${order.address.email}` : ''}</li>
            <li>Payment status : {order.paymentStatus}</li>
            <li>Captured amount : {formatPaise(order.refundSummary?.capturedPaise || 0)}</li>
            <li>Razorpay payment : {order.razorpayPaymentId || 'none recorded'}</li>
            <li>Duplicate payment IDs : {(order.duplicatePaymentIds || []).join(', ') || 'none'}</li>
            <li>Review reason : {detail.review.reason || 'not recorded'}</li>
            <li>Stock deducted : {stockDeductedLabel(detail.review)}</li>
            <li>Reservation held : {detail.review.reservationHeld ? 'Yes' : 'No'}</li>
            <li>Reconciliation : {detail.reconciliation.attempts} attempt(s)
              {detail.reconciliation.lastAttemptAt ? ` · last ${when(detail.reconciliation.lastAttemptAt)} – ${detail.reconciliation.lastOutcome}` : ''}</li>
          </ul>

          <div>
            <p className='font-medium'>Related payment anomalies</p>
            {detail.anomalies.length === 0 && <p className='text-stone-500'>None recorded.</p>}
            <ul className='grid gap-1'>
              {detail.anomalies.map(anomaly => (
                <li key={anomaly.id} className='border p-2'>
                  {anomalyKindLabel(anomaly.kind)} · {anomaly.paymentId || 'no payment id'} · {anomaly.investigationStatus}
                </li>
              ))}
            </ul>
          </div>

          {Array.isArray(order.statusHistory) && (
            <div>
              <p className='font-medium'>Previous admin actions</p>
              <ul className='grid gap-1'>
                {order.statusHistory.filter(entry => entry.kind === 'payment' && entry.actor === 'admin' && entry.note).map((entry, index) => (
                  <li key={index}>{when(entry.at)} · {entry.note}</li>
                ))}
              </ul>
            </div>
          )}

          {detail.review.pending ? (
            <div className='grid gap-2'>
              <label className='grid gap-1'>Reason for this decision (5–120 characters)
                <input value={reason} maxLength={120} onChange={event => setReason(event.target.value)} className='border p-2' />
              </label>
              {reviewActions(detail.review).map(item => (
                <div key={item.action}>
                  <button type='button' disabled={!item.enabled || Boolean(busy)} onClick={() => resolve(item.action)}
                    className='min-h-10 bg-rose-950 px-4 py-2 text-white disabled:opacity-50'>
                    {busy === item.action ? 'Saving…' : item.label}
                  </button>
                  {!item.enabled && <p className='mt-1 text-amber-900'>{item.message}</p>}
                </div>
              ))}
              <p className='text-stone-600'>The order stays on hold until a decision above succeeds. Refunding does not clear the hold or restock inventory.</p>
            </div>
          ) : <p className='text-stone-600'>No review is pending for this order.</p>}

          {payments.length > 0 && (
            <form onSubmit={refund} className='grid gap-2 sm:grid-cols-2'>
              <p className='sm:col-span-2 font-medium'>Refund a specific captured payment</p>
              <label className='grid gap-1'>Payment
                <select value={refundPaymentId} onChange={event => setRefundPaymentId(event.target.value)} className='border p-2'>
                  <option value=''>Select a payment</option>
                  {payments.map(payment => (
                    <option key={payment.paymentId} value={payment.paymentId}>
                      {payment.paymentId} ({payment.role}{payment.remainingPaise !== null ? `, refundable ${formatPaise(payment.remainingPaise)}` : ', verified by Razorpay on submit'})
                    </option>
                  ))}
                </select>
              </label>
              <label className='grid gap-1'>Refund amount (₹)
                <input inputMode='decimal' value={refundAmount} onChange={event => setRefundAmount(event.target.value)} className='border p-2' />
              </label>
              <label className='grid gap-1 sm:col-span-2'>Reason (5–120 characters)
                <input value={refundReason} maxLength={120} onChange={event => setRefundReason(event.target.value)} className='border p-2' />
              </label>
              <button type='submit' disabled={Boolean(busy)} className='min-h-10 border px-4 py-2 disabled:opacity-50'>
                {busy === 'refund' ? 'Submitting…' : 'Request payment refund'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

PaymentReviewPanel.propTypes = {
  order: PropTypes.object.isRequired,
  token: PropTypes.string.isRequired,
  onChanged: PropTypes.func.isRequired
}

export default PaymentReviewPanel
