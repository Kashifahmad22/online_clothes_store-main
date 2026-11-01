import { useCallback, useContext, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'
import axios from 'axios'
import { toast } from 'react-toastify'
import { openRazorpayCheckout } from '../utils/razorpayCheckout'
import OrderDetails from '../components/OrderDetails'
import { formatInr, formatOrderDate, formatOrderReference, fulfilmentLabel } from '../utils/orderDisplay'

// Mirrors the backend payable gate; the server remains authoritative and rejects ineligible retries.
const canRetryPayment = order => {
  if (order.paymentMethod !== 'Razorpay' || order.fulfillmentHold || order.paymentIssue) return false
  if (order.status !== 'Order Placed') return false
  if (order.paymentStatus === 'failed') return true
  return order.paymentStatus === 'pending' && Boolean(order.reservationHeld) &&
    new Date(order.reservationExpiresAt) > new Date()
}

const paymentNotice = order => {
  if (order.paymentMethod !== 'Razorpay') return ''
  if (order.paymentStatus === 'refunded') return 'This payment has been refunded.'
  if (order.paymentIssue === 'stock') {
    return 'We received your payment, but the item is currently unavailable. Our team is reviewing the order and will contact you. You do not need to pay again.'
  }
  if (order.paymentIssue === 'cancelled_capture') {
    return 'Your payment arrived after this order was cancelled. Our team is reviewing it; a refund has not yet been confirmed. You do not need to pay again.'
  }
  if (order.paymentIssue === 'duplicate') {
    return 'We detected more than one payment for this order. Our team is reviewing it and will contact you. Please do not pay again.'
  }
  if (order.paymentIssue === 'review') {
    return 'We have received your payment and our team is reviewing this order. You do not need to pay again.'
  }
  if (order.status === 'Cancelled' && order.paymentStatus === 'paid') {
    return 'This order was cancelled. Your payment is being reviewed by our team; a refund has not yet been confirmed.'
  }
  if (order.fulfillmentHold) {
    return 'We have received your payment and our team is reviewing this order. We will contact you with the outcome. You do not need to pay again.'
  }
  if (order.status === 'Cancelled') return 'This order was cancelled and can no longer be paid.'
  if (order.paymentStatus === 'authorized') return 'Your payment is being confirmed. Please check again shortly.'
  return ''
}

const Orders = () => {
  const { backendUrl, token, setCartItems, refreshCart } = useContext(ShopContext)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryingOrderId, setRetryingOrderId] = useState('')

  const loadOrderData = useCallback(async () => {
    if (!token) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const response = await axios.post(`${backendUrl}/api/order/userorders`, {}, { headers: { token } })
      if (!response.data.success) throw new Error(response.data.message || 'Unable to load your orders.')
      setOrders(response.data.orders || [])
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Unable to load your orders.'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [backendUrl, token])

  const retryPayment = async order => {
    if (retryingOrderId) return
    setRetryingOrderId(order._id)
    try {
      const response = await axios.post(
        `${backendUrl}/api/order/razorpay/retry`,
        { orderId: order._id },
        { headers: { token } }
      )
      if (!response.data.success) throw new Error(response.data.message || 'Unable to retry payment.')
      await openRazorpayCheckout({
        paymentOrder: response.data,
        onSuccess: async payment => {
          try {
            const verification = await axios.post(
              `${backendUrl}/api/order/verifyRazorpay`,
              { orderId: order._id, ...payment },
              { headers: { token } }
            )
            if (verification.data.success && verification.data.paymentStatus === 'paid') {
              // The server removes only purchased quantities, so reload the cart instead of emptying it.
              if (refreshCart) await refreshCart()
              else setCartItems({})
              toast.success(verification.data.message || 'Payment confirmed.')
            } else {
              toast.info(verification.data.message || 'Payment is still processing. Refresh your orders shortly.')
            }
          } catch (error) {
            toast.error(error.response?.data?.message || 'Payment status could not be confirmed. Refresh your orders.')
          } finally {
            await loadOrderData()
            setRetryingOrderId('')
          }
        },
        onFailure: event => {
          toast.error(event.error?.description || 'Payment did not complete. You can retry before the reservation expires.')
          setRetryingOrderId('')
        },
        onDismiss: () => setRetryingOrderId('')
      })
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to retry payment.')
      setRetryingOrderId('')
    }
  }

  useEffect(() => {
    loadOrderData()
  }, [loadOrderData])

  return (
    <main className='shopping-page'>
      <header className='shopping-heading'>
        <p className='eyebrow'>PSH Sarees & Ethnic Wear</p>
        <h1>Your orders</h1>
      </header>

      {loading && <p role='status' className='py-10 text-center text-sm text-stone-600'>Loading your order history…</p>}
      {!loading && !token && (
        <div className='catalogue-empty text-center'>
          <h2>Sign in to see your orders</h2>
          <p>Your order history is available once you are signed in.</p>
          <Link to='/login' className='button button--wine mt-5'>Sign in</Link>
        </div>
      )}
      {!loading && token && loadError && (
        <div role='alert' className='border border-red-200 bg-red-50 p-4 text-sm text-red-900'>
          <p>{loadError}</p>
          <button type='button' onClick={loadOrderData} className='button button--wine mt-3'>Try again</button>
        </div>
      )}
      {!loading && token && !loadError && orders.length === 0 && (
        <div className='catalogue-empty text-center'>
          <h2>No orders to show</h2>
          <p>Orders placed with this account will appear here.</p>
          <Link to='/collection' className='button button--wine mt-5'>Browse the collection</Link>
        </div>
      )}
      {!loading && token && !loadError && orders.map(order => (
        <section key={order._id} className='mb-8 border-t border-stone-200 pt-5' aria-label={`Order ${formatOrderReference(order)}`}>
          <div className='mb-4'>
            <h2 className='text-base font-semibold'>Order {formatOrderReference(order) || 'reference unavailable'}</h2>
            {formatOrderDate(order) && <p className='mt-1 text-sm text-stone-600'>Placed on {formatOrderDate(order)}</p>}
          </div>
          <OrderDetails order={order} fulfilment={fulfilmentLabel(order)} />
          {order.shipping?.courierName && (
            <div className='mt-3 border-l-2 border-amber-700 pl-4 text-sm text-stone-700'>
              <p className='font-medium'>Shipping updates</p>
              <p className='mt-1'>Courier: {order.shipping.courierName}</p>
              {order.shipping.trackingNumber && <p>Tracking number: {order.shipping.trackingNumber}</p>}
              {order.shipping.dispatchDate && (
                <p>Dispatched: {new Date(order.shipping.dispatchDate).toLocaleDateString('en-IN')}</p>
              )}
              {order.shipping.trackingUrl && /^https:\/\//i.test(order.shipping.trackingUrl) && (
                <a className='mt-1 inline-block underline underline-offset-2'
                  href={order.shipping.trackingUrl} target='_blank' rel='noopener noreferrer'>
                  Track shipment
                </a>
              )}
            </div>
          )}
          {order.refundedPaise > 0 && (
            <p className='mt-3 text-sm text-stone-700'>
              Refunded: {formatInr(order.refundedPaise)}
              {order.paymentStatus === 'refunded' ? ' (fully refunded)' : ' (partial refund)'}
            </p>
          )}
          {order.refundStatus === 'pending' && (
            <p className='mt-3 text-sm text-stone-700'>
              A refund for this order is being processed. We will update this page once it is confirmed.
            </p>
          )}
          {order.refundStatus === 'failed' && (
            <p className='mt-3 text-sm text-stone-700'>
              A refund for this order could not be completed. Our team will follow up with you.
            </p>
          )}
          {Array.isArray(order.timeline) && order.timeline.some(entry => entry.kind === 'fulfilment') && (
            <details className='mt-3 text-sm text-stone-700'>
              <summary className='cursor-pointer font-medium'>Order timeline</summary>
              <ol className='mt-2 grid gap-1 border-l-2 border-amber-700 pl-4'>
                {order.timeline.filter(entry => entry.kind === 'fulfilment').map((entry, index) => (
                  <li key={index}>
                    {entry.status}
                    {entry.at && <span className='text-stone-500'> · {new Date(entry.at).toLocaleString('en-IN')}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {paymentNotice(order) && (
            <p className='mt-3 border-l-2 border-amber-700 pl-4 text-sm text-stone-700'>{paymentNotice(order)}</p>
          )}
          {canRetryPayment(order) && (
              <button type='button' disabled={Boolean(retryingOrderId)}
                onClick={() => retryPayment(order)} className='button button--wine mt-4 disabled:opacity-50'>
                {retryingOrderId === order._id ? 'Opening secure payment…' : 'Retry online payment'}
              </button>
            )}
        </section>
      ))}
      {!loading && !loadError && orders.length > 0 && (
        <button type='button' onClick={loadOrderData} className='button button--wine mt-6'>Refresh order status</button>
      )}
    </main>
  )
}

export default Orders
