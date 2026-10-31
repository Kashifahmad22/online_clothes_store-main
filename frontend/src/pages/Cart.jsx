import { useContext, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'
import CartTotal from '../components/CartTotal'
import OptimizedImage from '../components/OptimizedImage'
import { availableQuantity, getProductImage, isVariantAvailable } from '../utils/productDisplay'

const Cart = () => {
  const { products, productsLoading, productsError, currency, cartItems, updateQuantity, navigate } = useContext(ShopContext)
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
              return (
                <article key={`${item.productId}-${item.variantId}`} className='cart-line'>
                  <Link to={product ? `/product/${product._id}` : '/collection'} className='cart-line__image'>
                    {image?.url
                      ? <OptimizedImage src={image.url} alt={image.altText || product.name}
                          widths={[120, 240]} sizes='96px' />
                      : <span aria-hidden='true'>Image unavailable</span>}
                  </Link>
                  <div className='cart-line__details'>
                    <h2>{product?.name || 'Product no longer available'}</h2>
                    <p className='cart-line__variant'>{optionLabel}</p>
                    {variant && <p className='cart-line__price'>{currency}{variant.price}</p>}
                    <p className={`cart-line__stock ${available ? '' : 'cart-line__stock--unavailable'}`}>
                      {available ? 'Available' : 'Currently unavailable'}
                    </p>
                    <label className='cart-line__quantity'>
                      <span>Quantity</span>
                      <input type='number' inputMode='numeric' min='1'
                        max={available ? availableQuantity(variant) : undefined}
                        value={item.quantity}
                        disabled={!available}
                        onChange={event => {
                          const nextQuantity = Number(event.target.value)
                          if (Number.isSafeInteger(nextQuantity) && nextQuantity >= 1) {
                            updateQuantity(item.productId, item.variantId, nextQuantity)
                          }
                        }} />
                    </label>
                  </div>
                  <button type='button' onClick={() => updateQuantity(item.productId, item.variantId, 0)}
                    className='cart-line__remove' aria-label={`Remove ${product?.name || 'unavailable item'} from cart`}>
                    Remove
                  </button>
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
