import { useContext, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'
import CartTotal from '../components/CartTotal'
import OptimizedImage from '../components/OptimizedImage'
import { availableQuantity, getProductImage, isVariantAvailable } from '../utils/productDisplay'

const Cart = () => {
  const { products, productsLoading, productsError, currency, cartItems, updateQuantity, navigate } = useContext(ShopContext)
  const [pendingLine, setPendingLine] = useState('')
  const changeQuantity = async (item, quantity) => {
    const key = `${item.productId}-${item.variantId}`
    if (pendingLine) return
    setPendingLine(key)
    try {
      await updateQuantity(item.productId, item.variantId, quantity)
    } finally {
      setPendingLine('')
    }
  }
  const cartData = useMemo(() => Object.entries(cartItems).flatMap(([productId, variants]) =>
    Object.entries(variants || {}).filter(([, quantity]) => quantity > 0).map(([variantId, quantity]) => ({
      productId,
      variantId,
      quantity,
      product: products.find(item => item._id === productId),
      variant: products.find(item => item._id === productId)?.variants?.find(item => item._id === variantId)
    }))
  ), [cartItems, products])
  const canCheckout = cartData.length > 0 && cartData.every(item =>
    item.product && item.variant && isVariantAvailable(item.variant) &&
    item.quantity <= availableQuantity(item.variant)
  )

  if (productsLoading && cartData.length === 0) {
    return <main className='shopping-page'><p className='py-20 text-center'>Loading your cart…</p></main>
  }

  return (
    <main className='shopping-page'>
      <header className='shopping-heading'>
        <p className='eyebrow'>PSH Sarees & Ethnic Wear</p>
        <h1>Your shopping bag</h1>
      </header>

      {productsError && (
        <p role='alert' className='my-5 border border-red-200 bg-red-50 p-4 text-sm text-red-900'>
          Product availability could not be refreshed. You can still remove items from your cart.
        </p>
      )}

      {cartData.length === 0 ? (
        <div className='catalogue-empty text-center'>
          <h2>Your cart is empty</h2>
          <p>Browse the catalogue and choose an available product option.</p>
          <button type='button' onClick={() => navigate('/collection')} className='button button--wine mt-5'>
            Shop sarees &amp; ethnic wear
          </button>
        </div>
      ) : (
        <div className='shopping-layout'>
          <section aria-label='Cart items' className='cart-lines'>
            {cartData.map(item => {
              const { product, variant } = item
              const image = getProductImage(product)
              const optionLabel = variant
                ? Object.values(variant.options || {}).join(' / ') || variant.sku
                : 'Unavailable option'
              const available = isVariantAvailable(variant)
              const maxQuantity = availableQuantity(variant)
              const overStock = available && item.quantity > maxQuantity
              const unitPaise = variant ? (variant.priceOverridePaise ?? product?.pricePaise) : null
              const lineTotal = Number.isSafeInteger(unitPaise) ? unitPaise * item.quantity / 100 : null
              const lineKey = `${item.productId}-${item.variantId}`
              const busy = pendingLine === lineKey
              const name = product?.name || 'unavailable item'
              return (
                <article key={lineKey} className='cart-line' aria-busy={busy}>
                  <Link to={product ? `/product/${product.slug || product._id}` : '/collection'} className='cart-line__image'
                    aria-label={`View ${name}`}>
                    {image?.url
                      ? <OptimizedImage src={image.url} alt={image.altText || product.name}
                          widths={[120, 240]} sizes='96px' />
                      : <span aria-hidden='true'>Image unavailable</span>}
                  </Link>
                  <div className='cart-line__details'>
                    <h2>{product?.name || 'Product no longer available'}</h2>
                    <p className='cart-line__variant'>{optionLabel}</p>
                    {variant && <p className='cart-line__price'>{currency}{variant.price}</p>}
                    {!available && <p className='cart-line__stock cart-line__stock--unavailable' role='alert'>
                      Currently unavailable. Remove this item to continue.
                    </p>}
                    {overStock && (
                      <p className='cart-line__stock cart-line__stock--unavailable' role='alert'>
                        Only {maxQuantity} available.{' '}
                        <button type='button' className='underline' disabled={busy}
                          onClick={() => changeQuantity(item, maxQuantity)}>Reduce to {maxQuantity}</button>
                      </p>
                    )}
                    <div className='cart-line__actions'>
                      <div className='qty-stepper' role='group' aria-label={`Quantity for ${name}`}>
                        <button type='button' aria-label={`Decrease quantity of ${name}`}
                          disabled={!available || busy || item.quantity <= 1}
                          onClick={() => changeQuantity(item, item.quantity - 1)}>−</button>
                        <input type='number' inputMode='numeric' min='1' step='1'
                          max={available ? maxQuantity : undefined}
                          aria-label={`Quantity of ${name}`}
                          value={item.quantity} disabled={!available || busy}
                          onChange={event => {
                            const next = Number(event.target.value)
                            if (Number.isSafeInteger(next) && next >= 1) changeQuantity(item, next)
                          }} />
                        <button type='button' aria-label={`Increase quantity of ${name}`}
                          disabled={!available || busy || item.quantity >= maxQuantity}
                          onClick={() => changeQuantity(item, item.quantity + 1)}>+</button>
                      </div>
                      <button type='button' disabled={busy} onClick={() => changeQuantity(item, 0)}
                        className='cart-line__remove' aria-label={`Remove ${name} from cart`}>
                        Remove
                      </button>
                    </div>
                  </div>
                  {lineTotal !== null && (
                    <p className='cart-line__total' aria-label={`Line total ${currency}${lineTotal}`}>
                      {currency}{lineTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </p>
                  )}
                </article>
              )
            })}
          </section>

          <aside className='cart-summary'>
            <h2>Order summary</h2>
            <CartTotal />
            <button type='button' disabled={!canCheckout} onClick={() => navigate('/place-order')}
              className='button button--wine mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50'>
              Continue to secure checkout
            </button>
            {!canCheckout && <p className='mt-3 text-xs leading-5 text-stone-600'>Remove unavailable items or adjust quantities before checkout.</p>}
            <Link to='/collection' className='cart-summary__continue'>Continue shopping</Link>
          </aside>
        </div>
      )}
    </main>
  )
}

export default Cart
