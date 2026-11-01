import { useContext, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { ShopContext } from '../context/ShopContext'
import CartTotal from './CartTotal'
import { formatInr } from '../utils/orderDisplay'

const optionText = options => Object.entries(options || {}).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(' · ')

// Line items and totals come from the server quote (POST /api/order/quote); the cart total is only an estimate fallback.
const CheckoutSummary = ({ onStatusChange }) => {
  const { backendUrl, token, cartItems, getCartAmountPaise } = useContext(ShopContext)
  const [quote, setQuote] = useState(null)
  const [state, setState] = useState('loading')

  const items = useMemo(() => {
    const list = []
    for (const productId of Object.keys(cartItems)) {
      for (const variantId of Object.keys(cartItems[productId])) {
        const quantity = cartItems[productId][variantId]
        if (Number.isSafeInteger(quantity) && quantity > 0) list.push({ productId, variantId, quantity })
      }
    }
    return list
  }, [cartItems])

  useEffect(() => {
    if (!token || items.length === 0) {
      setQuote(null)
      setState('empty')
      return undefined
    }
    let cancelled = false
    setState('loading')
    axios.post(`${backendUrl}/api/order/quote`, { items }, { headers: { token } })
      .then(response => {
        if (cancelled) return
        if (!response.data.success) throw new Error('quote failed')
        setQuote(response.data)
        setState(response.data.hasIssues ? 'issues' : 'ready')
      })
      .catch(() => {
        if (cancelled) return
        setQuote(null)
        setState('error')
      })
    return () => { cancelled = true }
  }, [backendUrl, token, items])

  useEffect(() => { onStatusChange?.(state) }, [state, onStatusChange])

  if (state === 'loading') return <p role='status' className='text-sm text-stone-600'>Confirming prices…</p>
  if (state === 'empty') return <p className='text-sm text-stone-600'>Your bag is empty. <Link to='/collection' className='underline'>Continue shopping</Link></p>
  if (state === 'error' || !quote) {
    return (
      <>
        <p role='status' className='mb-3 text-sm text-stone-600'>
          We could not confirm live prices just now. The total below is an estimate; the final amount is confirmed when you place the order.
        </p>
        <CartTotal />
      </>
    )
  }

  const changed = Number.isFinite(getCartAmountPaise?.()) && getCartAmountPaise() !== quote.subtotalPaise && state === 'ready'

  return (
    <div className='checkout-lines'>
      {changed && (
        <p role='status' className='mb-3 text-sm text-amber-800'>Some prices have changed since you added items. The amounts below are current.</p>
      )}
      {state === 'issues' && (
        <p role='alert' className='mb-3 border border-red-200 bg-red-50 p-3 text-sm text-red-900'>
          Some items are no longer available in the quantity you chose. <Link to='/cart' className='underline'>Review your bag</Link> before placing the order.
        </p>
      )}
      <ul className='checkout-lines__list'>
        {quote.lines.map(line => (
          <li key={line.variantId} className='checkout-line'>
            {line.image
              ? <img src={line.image} alt={line.name || 'Product'} />
              : <div className='order-line__image-placeholder' role='img' aria-label='Product image unavailable' />}
            <div className='checkout-line__body'>
              <p className='checkout-line__name'>{line.name || 'Item no longer available'}</p>
              {optionText(line.options) && <p className='checkout-line__meta'>{optionText(line.options)}</p>}
              {line.status === 'unavailable' && <p className='checkout-line__issue'>No longer available</p>}
              {line.status === 'insufficient' && (
                <p className='checkout-line__issue'>
                  {line.availableQuantity > 0 ? `Only ${line.availableQuantity} available` : 'Out of stock'}
                </p>
              )}
              {Number.isFinite(line.unitPricePaise) && (
                <p className='checkout-line__meta'>Qty {line.quantity} × {formatInr(line.unitPricePaise)}</p>
              )}
            </div>
            {Number.isFinite(line.lineTotalPaise) && <p className='checkout-line__total'>{formatInr(line.lineTotalPaise)}</p>}
          </li>
        ))}
      </ul>
      <dl className='order-totals'>
        <dt>Subtotal</dt><dd>{formatInr(quote.subtotalPaise)}</dd>
        <dt>Shipping</dt><dd>{quote.shippingPaise === 0 ? 'Free' : formatInr(quote.shippingPaise)}</dd>
        <dt className='order-totals__total'>Total payable</dt><dd className='order-totals__total'>{formatInr(quote.totalPaise)}</dd>
      </dl>
    </div>
  )
}

export default CheckoutSummary
