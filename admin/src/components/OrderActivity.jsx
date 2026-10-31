import { useCallback, useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { toast } from 'react-toastify'
import { backendUrl } from '../App'

const TYPE_LABELS = {
  order_placed: 'Order placed',
  payment_success: 'Payment successful',
  order_dispatched: 'Order dispatched',
  out_for_delivery: 'Out for delivery',
  order_delivered: 'Order delivered',
  return_approved: 'Return approved',
  refund_processed: 'Refund processed'
}

const formatDate = value => value ? new Date(value).toLocaleString('en-IN') : ''

const OrderActivity = ({ order, token, onChanged }) => {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(null)
  const [busy, setBusy] = useState('')

  const loadNotifications = useCallback(async () => {
    try {
      const response = await axios.post(`${backendUrl}/api/order/notifications`, { orderId: order._id }, { headers: { token } })
      if (!response.data.success) throw new Error(response.data.message)
      setNotifications(response.data.notifications)
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to load notifications.')
    }
  }, [order._id, token])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) loadNotifications()
  }

  const retry = async (notificationId, channel) => {
    setBusy(`${notificationId}:${channel}`)
    try {
      const response = await axios.post(`${backendUrl}/api/order/notifications/retry`,
        { notificationId, channel }, { headers: { token } })
      if (!response.data.success) throw new Error(response.data.message)
      toast.info(`Retry result: ${response.data.outcome || 'attempted'}`)
      await loadNotifications()
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Retry failed.')
    } finally {
      setBusy('')
    }
  }

  const markCodCollected = async () => {
    setBusy('cod')
    try {
      const response = await axios.post(`${backendUrl}/api/order/cod-collected`, { orderId: order._id }, { headers: { token } })
      if (!response.data.success) throw new Error(response.data.message)
      toast.success(response.data.message || 'COD marked as collected.')
      await onChanged()
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to mark COD collected.')
    } finally {
      setBusy('')
    }
  }

  const canCollectCod = order.paymentMethod === 'COD' && order.paymentStatus === 'cod_pending' && order.status === 'Delivered'
  const history = order.statusHistory || []

  return (
    <div className='col-span-full border-t pt-4'>
      {canCollectCod && (
        <button type='button' onClick={markCodCollected} disabled={busy === 'cod'}
          className='mb-3 mr-3 min-h-10 border border-rose-950 px-4 py-2 text-rose-950 disabled:opacity-50'>
          Mark COD cash as collected
        </button>
      )}
      <button type='button' onClick={toggle} aria-expanded={open} className='min-h-10 border px-4 py-2'>
        {open ? 'Hide history & notifications' : 'Show history & notifications'}
      </button>
      {open && (
        <div className='mt-3 grid gap-4 md:grid-cols-2'>
          <section>
            <h4 className='mb-2 font-medium'>Status history</h4>
            {history.length === 0 && <p className='text-stone-500'>No history recorded for this order.</p>}
            <ul className='grid gap-1'>
              {history.map((entry, index) => (
                <li key={index}>
                  <span className='font-medium'>{entry.kind === 'payment' ? 'Payment' : 'Fulfilment'}:</span>{' '}
                  {entry.from ? `${entry.from} → ` : ''}{entry.to}
                  <span className='text-stone-500'> · {entry.actor} · {formatDate(entry.at)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h4 className='mb-2 font-medium'>Customer notifications</h4>
            {notifications === null && <p className='text-stone-500'>Loading…</p>}
            {notifications?.length === 0 && <p className='text-stone-500'>No notifications recorded.</p>}
            <ul className='grid gap-2'>
              {(notifications || []).map(event => (
                <li key={event._id}>
                  <p className='font-medium'>{TYPE_LABELS[event.type] || event.type}
                    <span className='font-normal text-stone-500'> · {formatDate(event.createdAt)}</span></p>
                  {['email', 'whatsapp'].map(channel => {
                    const state = event.channels[channel]
                    const retryable = ['failed', 'skipped'].includes(state.status)
                    return (
                      <p key={channel} className='flex flex-wrap items-center gap-2'>
                        <span className='capitalize'>{channel}:</span> {state.status}
                        {state.reason && <span className='text-stone-500'>({state.reason})</span>}
                        {state.attempts > 0 && <span className='text-stone-500'>attempts {state.attempts}</span>}
                        {retryable && (
                          <button type='button' disabled={busy === `${event._id}:${channel}`}
                            onClick={() => retry(event._id, channel)} className='border px-2 py-1 disabled:opacity-50'>
                            Retry
                          </button>
                        )}
                      </p>
                    )
                  })}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}

OrderActivity.propTypes = {
  order: PropTypes.object.isRequired,
  token: PropTypes.string.isRequired,
  onChanged: PropTypes.func.isRequired
}

export default OrderActivity
