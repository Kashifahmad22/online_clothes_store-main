import {
  addressLines, formatInr, orderLines, orderTotals, paymentMethodLabel, paymentStatusLabel
} from '../utils/orderDisplay'

// Customer-facing items, totals, payment and delivery address, shared by the Orders page and the confirmation page.
const OrderDetails = ({ order, showStatus = true, fulfilment = '' }) => {
  const lines = orderLines(order)
  const totals = orderTotals(order)
  const address = addressLines(order.address)
  const payment = paymentStatusLabel(order)
  const method = paymentMethodLabel(order)

  return (
    <div className='order-details'>
      {lines.map((item, index) => (
        <article key={`${item.variantId || item.sku || item.name}-${index}`} className='order-line'>
          {item.image?.[0]
            ? <img src={item.image[0]} alt={item.name || 'Ordered product'} />
            : <div className='order-line__image-placeholder' role='img' aria-label='Product image unavailable' />}
          <div className='order-line__details'>
            <h3>{item.name}</h3>
            {item.size && <p>Size: {item.size}</p>}
            <p>
              {item.quantity !== null ? `Qty ${item.quantity}` : ''}
              {item.unitPaise !== null && <> <span>·</span> {formatInr(item.unitPaise)} each</>}
            </p>
            {item.sku && <p>SKU: {item.sku}</p>}
          </div>
          <div className='order-line__status'>
            {item.lineTotalPaise !== null && <strong>{formatInr(item.lineTotalPaise)}</strong>}
          </div>
        </article>
      ))}

      <dl className='order-totals'>
        {totals.subtotalPaise !== null && <><dt>Subtotal</dt><dd>{formatInr(totals.subtotalPaise)}</dd></>}
        {totals.shippingPaise !== null && (
          <><dt>Shipping</dt><dd>{totals.shippingPaise === 0 ? 'Free' : formatInr(totals.shippingPaise)}</dd></>
        )}
        {totals.totalPaise !== null && <><dt className='order-totals__total'>Order total</dt><dd className='order-totals__total'>{formatInr(totals.totalPaise)}</dd></>}
      </dl>

      <div className='order-meta'>
        {(method || payment) && (
          <div>
            <h3>Payment</h3>
            {method && <p>{method}</p>}
            {payment && <p>{payment}</p>}
            {order.fulfillmentHold && <p className='font-medium text-amber-800'>Payment received; order review is in progress.</p>}
          </div>
        )}
        {showStatus && (fulfilment || order.status) && (
          <div>
            <h3>Order status</h3>
            <p>{fulfilment || order.status}</p>
          </div>
        )}
        {address.length > 0 && (
          <div>
            <h3>Delivery address</h3>
            <address>{address.map((line, index) => <span key={index}>{line}<br /></span>)}</address>
          </div>
        )}
      </div>
    </div>
  )
}

export default OrderDetails
