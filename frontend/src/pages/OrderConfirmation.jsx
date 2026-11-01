import { useContext, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import axios from 'axios'
import { ShopContext } from '../context/ShopContext'
import OrderDetails from '../components/OrderDetails'
import { formatOrderDate, formatOrderReference } from '../utils/orderDisplay'

// Reads an existing order only: refreshing this page never posts a new order.
const OrderConfirmation = () => {
  const { orderId } = useParams()
  const { state } = useLocation()
  const { backendUrl, token } = useContext(ShopContext)
  const handedOver = state?.order && String(state.order._id) === orderId ? state.order : null
  const [order, setOrder] = useState(handedOver)
  const [loading, setLoading] = useState(!handedOver && Boolean(token))
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (order || !token) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    axios.post(`${backendUrl}/api/order/userorders`, {}, { headers: { token } })
      .then(response => {
        if (cancelled) return
        if (!response.data.success) throw new Error(response.data.message || 'Unable to load your order.')
        const found = (response.data.orders || []).find(item => String(item._id) === orderId)
        if (found) setOrder(found)
        else setError('We could not find this order on your account.')
      })
      .catch(err => {
        if (!cancelled) setError(err.response?.data?.message || err.message || 'Unable to load your order.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [backendUrl, token, orderId, order, attempt])

  const reference = order ? formatOrderReference(order) : ''
  const isCod = order?.paymentMethod === 'COD'

  return (
    <main className='shopping-page' data-testid='order-confirmation'>
      <header className='shopping-heading'>
        <p className='eyebrow'>PSH Sarees &amp; Ethnic Wear</p>
        <h1>{order ? (isCod ? 'Thank you, your order is placed' : 'Your order') : 'Order details'}</h1>
      </header>

      {loading && <p role='status' className='py-10 text-center text-sm text-stone-600'>Loading your order…</p>}
      {!loading && !token && !order && (
        <div className='catalogue-empty text-center'>
          <h2>Sign in to view this order</h2>
          <Link to='/login' className='button button--wine mt-5'>Sign in</Link>
        </div>
      )}
      {!loading && error && !order && (
        <div role='alert' className='border border-red-200 bg-red-50 p-4 text-sm text-red-900'>
          <p>{error}</p>
          <div className='mt-3 flex flex-wrap gap-3'>
            <button type='button' onClick={() => setAttempt(value => value + 1)} className='button button--wine'>Try again</button>
            <Link to='/orders' className='button button--wine'>View your orders</Link>
          </div>
        </div>
      )}
      {order && (
        <section className='order-confirmation'>
          <div className='order-confirmation__summary'>
            {reference && <p>Order reference: <strong>{reference}</strong></p>}
            {formatOrderDate(order) && <p>Placed on {formatOrderDate(order)}</p>}
            {isCod && (
              <p>
                You chose Cash on Delivery.                 No payment is needed now. Please pay the order total
                when your order is delivered.
              </p>
            )}
          </div>
          <OrderDetails order={order} />
          <div className='mt-6 flex flex-wrap gap-3'>
            <Link to='/collection' className='button button--wine'>Continue shopping</Link>
            <Link to='/orders' className='button button--wine'>View your orders</Link>
          </div>
        </section>
      )}
    </main>
  )
}

export default OrderConfirmation
