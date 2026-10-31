import { useCallback, useContext, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'
import axios from 'axios'
import { toast } from 'react-toastify'
import { openRazorpayCheckout } from '../utils/razorpayCheckout'

const Orders = () => {
  const { backendUrl, token, currency, setCartItems } = useContext(ShopContext)
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
              setCartItems({})
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

      {loading && <p className='py-10 text-center text-sm text-stone-600'>Loading your order history…</p>}
      {!loading && loadError && <p role='alert' className='border border-red-200 bg-red-50 p-4 text-sm text-red-900'>{loadError}</p>}
      {!loading && !loadError && orders.length === 0 && (
        <div className='catalogue-empty text-center'>
          <h2>No orders to show</h2>
          <p>Orders placed with this account will appear here.</p>
          <Link to='/collection' className='button button--wine mt-5'>Browse the collection</Link>
        </div>
      )}
      {!loading && !loadError && orders.map(order => (
        <section key={order._id} className='mb-8 border-t border-stone-200 pt-5'>
          <div className='mb-4 flex flex-wrap items-start justify-between gap-3'>
            <div>
              <p className='text-sm font-semibold'>Order {order._id}</p>
              <p className='mt-1 text-sm text-stone-600'>
                Placed: {Number.isFinite(Number(order.date))
                  ? new Date(Number(order.date)).toLocaleDateString('en-IN')
                  : 'Date unavailable'}
              </p>
            </div>
            <div className='text-sm'>
              <p>{order.paymentMethod === 'COD' ? 'Cash on delivery' : order.paymentMethod || 'Payment method unavailable'}</p>
              <p className='mt-1 text-stone-600'>Payment: {order.paymentStatus || (order.payment ? 'paid' : 'pending')}</p>
              {order.fulfillmentHold && <p className='mt-1 font-medium text-amber-800'>Payment received; order review is in progress.</p>}
            </div>
          </div>
          {(order.items || []).map((item, index) => (
            <article key={`${item.variantId || item.sku || item.name}-${index}`} className='order-line'>
              {item.image?.[0]
                ? <img src={item.image[0]} alt={item.name || 'Ordered product'} />
                : <div className='order-line__image-placeholder' aria-label='Product image unavailable' />}
              <div className='order-line__details'>
                <h2>{item.name}</h2>
                <p>{currency}{item.price} <span>·</span> Quantity: {item.quantity}</p>
                <p>SKU: {item.sku || 'Not recorded'}</p>
              </div>
              <div className='order-line__status'>
                <span className='order-status-mark' aria-hidden='true' />
                <span>{order.status || 'Status unavailable'}</span>
              </div>
            </article>
          ))}
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
              Refunded: {currency}{(order.refundedPaise / 100).toFixed(2)}
              {order.paymentStatus === 'refunded' ? ' (fully refunded)' : ' (partial refund)'}
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
          {order.paymentMethod === 'Razorpay' && ['pending', 'failed'].includes(order.paymentStatus) &&
            ((order.reservationHeld && new Date(order.reservationExpiresAt) > new Date()) ||
              order.paymentStatus === 'failed') && (
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
