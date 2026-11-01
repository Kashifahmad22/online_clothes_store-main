import { useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { toast } from 'react-toastify'
import { backendUrl } from '../App'
import {
  REFUND_STATUS_LABELS,
  canShowRefundForm,
  formatPaise,
  refundIdempotencyKey,
  validateRefundForm
} from '../utils/refunds'

const formatDate = value => value ? new Date(value).toLocaleString('en-IN') : ''

// Refund records are shown exactly as the backend reports them: a pending refund is never styled as complete.
const RefundPanel = ({ order, token, onChanged }) => {
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [formKey, setFormKey] = useState(refundIdempotencyKey)
  const [busy, setBusy] = useState('')
  const refunds = order.refunds || []
  const summary = order.refundSummary || {}
  if (order.paymentMethod !== 'Razorpay' || (!['paid', 'refunded'].includes(order.paymentStatus) && refunds.length === 0)) return null

  const post = async (path, body) => {
    const response = await axios.post(`${backendUrl}/api/order/${path}`, body, { headers: { token } })
    return response.data
  }

  const submit = async event => {
    event.preventDefault()
    const checked = validateRefundForm({ amountText, reason }, summary.remainingPaise || 0)
    if (checked.error) { toast.error(checked.error); return }
    setBusy('refund')
    try {
      const data = await post('refund', { orderId: order._id, amountPaise: checked.paise, reason: checked.reason, idempotencyKey: formKey })
      toast.info(data.message || 'Refund submitted.')
      setAmountText(''); setReason(''); setFormKey(refundIdempotencyKey())
    } catch (error) {
      // Keep the key only when the outcome is unknown (no response / 5xx); a definitive answer needs a fresh key.
      const status = error.response?.status
      if (status && status < 500) setFormKey(refundIdempotencyKey())
      toast.error(error.response?.data?.message || 'Refund request failed.')
    } finally {
      setBusy('')
      await onChanged()
    }
  }

  const sync = async () => {
    setBusy('sync')
    try {
      await post('refund/sync', { orderId: order._id })
      toast.info('Refund status checked with Razorpay.')
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not check refund status.')
    } finally {
      setBusy('')
      await onChanged()
    }
  }

  return (
    <div className='col-span-full border-t pt-4' aria-label='Refunds'>
      <p className='font-medium'>Refunds</p>
      <p>Captured : {formatPaise(summary.capturedPaise || 0)} · Refunded : {formatPaise(summary.processedPaise || 0)} · In progress : {formatPaise(summary.inFlightPaise || 0)} · Refundable : {formatPaise(summary.remainingPaise || 0)}</p>
      {refunds.length === 0 && <p className='text-stone-500'>No refunds recorded.</p>}
      <ul className='mt-2 grid gap-2'>
        {refunds.map((refund, index) => (
          <li key={refund.internalId || refund.refundId || index} className='border p-2'>
            <p><span className='font-medium'>{formatPaise(refund.amountPaise)}</span> – {REFUND_STATUS_LABELS[refund.status] || refund.status}</p>
            {refund.reason && <p>Reason : {refund.reason}</p>}
            {refund.refundId && <p>Razorpay refund : {refund.refundId}</p>}
            <p>Initiated : {formatDate(refund.requestedAt) || 'earlier (before tracking)'}{refund.processedAt ? ` · Processed : ${formatDate(refund.processedAt)}` : ''}</p>
            {refund.status === 'failed' && refund.failureReason && <p className='text-red-700'>{refund.failureReason}</p>}
          </li>
        ))}
      </ul>
      {refunds.some(refund => ['requested', 'pending'].includes(refund.status)) && (
        <button type='button' onClick={sync} disabled={Boolean(busy)} className='mt-2 min-h-10 border px-4 py-2 disabled:opacity-50'>
          {busy === 'sync' ? 'Checking…' : 'Check refund status'}
        </button>
      )}
      {canShowRefundForm(order) && (
        <form onSubmit={submit} className='mt-3 grid gap-2 sm:grid-cols-2'>
          <label className='grid gap-1'>Refund amount (₹)
            <input inputMode='decimal' value={amountText} onChange={event => setAmountText(event.target.value)} className='border p-2' />
          </label>
          <label className='grid gap-1'>Reason (5–120 characters)
            <input value={reason} maxLength={120} onChange={event => setReason(event.target.value)} className='border p-2' />
          </label>
          <p className='sm:col-span-2 text-stone-600'>Refunding does not restock inventory or clear a review hold.</p>
          <button type='submit' disabled={Boolean(busy)} className='min-h-10 bg-rose-950 px-4 py-2 text-white disabled:opacity-50'>
            {busy === 'refund' ? 'Submitting…' : 'Request refund'}
          </button>
        </form>
      )}
    </div>
  )
}

RefundPanel.propTypes = {
  order: PropTypes.object.isRequired,
  token: PropTypes.string.isRequired,
  onChanged: PropTypes.func.isRequired
}

export default RefundPanel
