import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { backendUrl, currency } from '../App'
import { toast } from 'react-toastify'
import { assets } from '../assets/assets'
import OrderActivity from '../components/OrderActivity'

const Orders = ({ token }) => {

  const [orders, setOrders] = useState([])
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [shippingDrafts, setShippingDrafts] = useState({})
  const [savingShippingOrderId, setSavingShippingOrderId] = useState('')

  const fetchAllOrders = useCallback(async () => {
    if (!token) return

    try {

      const response = await axios.post(backendUrl + '/api/order/list', {}, { headers: { token } })
      if (response.data.success) {
        setOrders(response.data.orders.reverse())
      } else {
        toast.error(response.data.message)
      }

    } catch (error) {
      toast.error(error.message)
    }
  }, [token])

  const statusHandler = async ( event, orderId ) => {
    try {
      const response = await axios.post(backendUrl + '/api/order/status' , {orderId, status:event.target.value}, { headers: {token}})
      if (response.data.success) {
        await fetchAllOrders()
      } else {
        toast.error(response.data.message || 'Unable to update order status.')
        await fetchAllOrders()
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to update order status.')
      await fetchAllOrders()
    }
  }

  const shippingDraft = order => shippingDrafts[order._id] || {
    courierName: order.shipping?.courierName || '',
    trackingNumber: order.shipping?.trackingNumber || '',
    trackingUrl: order.shipping?.trackingUrl || '',
    notes: order.shipping?.notes || ''
  }

  const updateShippingDraft = (orderId, field, value) => {
    const order = orders.find(item => item._id === orderId)
    setShippingDrafts(current => {
      const existing = current[orderId] || {
        courierName: order?.shipping?.courierName || '',
        trackingNumber: order?.shipping?.trackingNumber || '',
        trackingUrl: order?.shipping?.trackingUrl || '',
        notes: order?.shipping?.notes || ''
      }
      return { ...current, [orderId]: { ...existing, [field]: value } }
    })
  }

  const saveShipping = async (event, order) => {
    event.preventDefault()
    if (savingShippingOrderId) return
    setSavingShippingOrderId(order._id)
    try {
      const response = await axios.post(
        `${backendUrl}/api/order/shipping`,
        { orderId: order._id, shipping: shippingDraft(order) },
        { headers: { token } }
      )
      if (!response.data.success) throw new Error(response.data.message || 'Unable to save shipping details.')
      toast.success(response.data.message || 'Shipping details saved.')
      setShippingDrafts(current => {
        const next = { ...current }
        delete next[order._id]
        return next
      })
      await fetchAllOrders()
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to save shipping details.')
    } finally {
      setSavingShippingOrderId('')
    }
  }

  const filteredOrders = orders.filter(order =>
    (paymentFilter === 'all' || (order.paymentStatus || (order.payment ? 'paid' : 'pending')) === paymentFilter) &&
    (statusFilter === 'all' || order.status === statusFilter)
  )

  useEffect(() => {
    fetchAllOrders()
  }, [fetchAllOrders])

  return (
    <div>
      <h3>Order management</h3>
      <div className='my-4 flex flex-wrap gap-3'>
        <label className='flex items-center gap-2 text-sm'>
          Payment
          <select value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)} className='border p-2'>
            <option value='all'>All payment states</option>
            <option value='cod_pending'>COD due</option>
            <option value='pending'>Pending</option>
            <option value='authorized'>Authorized</option>
            <option value='paid'>Paid</option>
            <option value='failed'>Failed</option>
            <option value='expired'>Expired</option>
            <option value='refunded'>Refunded</option>
          </select>
        </label>
        <label className='flex items-center gap-2 text-sm'>
          Fulfilment
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className='border p-2'>
            <option value='all'>All fulfilment states</option>
            {['Order Placed', 'Processing', 'Packing', 'Packed', 'Shipped',
              'Out for delivery', 'Delivered', 'Cancelled', 'Return Requested', 'Return Approved'].map(status => (
              <option value={status} key={status}>{status}</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        {
          filteredOrders.map((order, index) => (
            <div className='grid grid-cols-1 sm:grid-cols-[0.5fr_2fr_1fr] lg:grid-cols-[0.5fr_2fr_1fr_1fr_1fr] gap-3 items-start border-2 border-gray-200 p-5 md:p-8 my-3 md:my-4 text-xs sm:text-sm text-gray-700' key={index}>
              <img className='w-12' src={assets.parcel_icon} alt="" />
              <div>
                <div>
                  {order.items.map((item, index) => {
                    if (index === order.items.length - 1) {
                      return <p className='py-0.5' key={index}> {item.name} x {item.quantity} <span> {item.sku || item.size} </span> </p>
                    }
                    else {
                      return <p className='py-0.5' key={index}> {item.name} x {item.quantity} <span> {item.sku || item.size} </span> ,</p>
                    }
                  })}
                </div>
                <p className='mt-3 mb-2 font-medium'>{order.address.firstName + " " + order.address.lastName}</p>
                <p>{order.address.email}</p>
                <div>
                  <p>{order.address.street + ","}</p>
                  <p>{order.address.city + ", " + order.address.state + ", " + order.address.country + ", " + order.address.zipcode}</p>
                </div>
                <p>{order.address.phone}</p>
              </div>
              <div>
                <p className='text-sm sm:text-[15px]'>Items : {order.items.length}</p>
                <p className='mt-3'>Method : {order.paymentMethod}</p>
                <p>Payment : {order.paymentStatus || (order.payment ? 'paid' : 'pending')}</p>
                {order.refundedPaise > 0 && <p>Refunded : {currency}{order.refundedPaise / 100}</p>}
                {order.razorpayOrderId && <p>Razorpay order : {order.razorpayOrderId}</p>}
                {order.razorpayPaymentId && <p>Payment reference : {order.razorpayPaymentId}</p>}
                {order.fulfillmentHold && <p className='mt-1 font-medium text-amber-800'>Payment review hold</p>}
                <p>Date : {new Date(order.date).toLocaleDateString()}</p>
              </div>
              <p className='text-sm sm:text-[15px]'>{currency}{order.amount}</p>
              <select onChange={(event)=>statusHandler(event,order._id)} value={order.status}
                disabled={order.paymentMethod === 'Razorpay' &&
                  (order.paymentStatus !== 'paid' || order.fulfillmentHold)}
                aria-label='Fulfilment status'
                className='p-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50'>
                {(order.allowedStatuses || [order.status]).map(status => (
                  <option value={status} key={status}>{status}</option>
                ))}
              </select>
              <form onSubmit={event => saveShipping(event, order)} className='col-span-full grid gap-2 border-t pt-4 sm:grid-cols-2'>
                <label className='grid gap-1'>Courier name
                  <input value={shippingDraft(order).courierName}
                    onChange={event => updateShippingDraft(order._id, 'courierName', event.target.value)}
                    maxLength={100} className='border p-2' />
                </label>
                <label className='grid gap-1'>AWB / tracking number
                  <input value={shippingDraft(order).trackingNumber}
                    onChange={event => updateShippingDraft(order._id, 'trackingNumber', event.target.value)}
                    maxLength={100} className='border p-2' />
                </label>
                <label className='grid gap-1 sm:col-span-2'>Tracking URL (HTTPS)
                  <input type='url' value={shippingDraft(order).trackingUrl}
                    onChange={event => updateShippingDraft(order._id, 'trackingUrl', event.target.value)}
                    maxLength={2048} className='border p-2' placeholder='https://...' />
                </label>
                <label className='grid gap-1 sm:col-span-2'>Internal shipping notes (never shown to customers)
                  <textarea value={shippingDraft(order).notes}
                    onChange={event => updateShippingDraft(order._id, 'notes', event.target.value)}
                    maxLength={1000} rows={2} className='border p-2' />
                </label>
                {order.shipping?.dispatchDate && (
                  <p className='self-center text-stone-600'>
                    Dispatched: {new Date(order.shipping.dispatchDate).toLocaleDateString('en-IN')}
                  </p>
                )}
                <button type='submit' disabled={savingShippingOrderId === order._id}
                  className='min-h-10 bg-rose-950 px-4 py-2 text-white disabled:opacity-50'>
                  {savingShippingOrderId === order._id ? 'Saving…' : 'Save shipping details'}
                </button>
              </form>
              <OrderActivity order={order} token={token} onChanged={fetchAllOrders} />
            </div>
          ))
        }
        {filteredOrders.length === 0 && <p className='py-8 text-center'>No orders match these filters.</p>}
      </div>
    </div>
  )
}

Orders.propTypes = {
  token: PropTypes.string.isRequired
}

export default Orders