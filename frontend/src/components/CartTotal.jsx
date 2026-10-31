import { useContext } from 'react'
import { ShopContext } from '../context/ShopContext'

const CartTotal = () => {

    const {
        getShippingAmount, getCartAmount, getCartAmountPaise,
        siteSettingsError, siteSettings
    } = useContext(ShopContext);
    const subtotal = getCartAmount()
    const subtotalPaise = getCartAmountPaise()
    const shippingFee = getShippingAmount(subtotalPaise)
    const total = subtotal === 0 ? 0 : subtotal + shippingFee
    const freeShippingThreshold = siteSettings.shipping.freeShippingThresholdPaise
    const formatPrice = amount => new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2
    }).format(amount)

  return (
    <div className='w-full'>
      <dl className='flex flex-col gap-3 text-sm text-stone-700'>
            <div className='flex justify-between gap-4'>
                <dt>Subtotal</dt>
                <dd>{formatPrice(subtotal)}</dd>
            </div>
            <div className='flex justify-between gap-4'>
                <dt>{siteSettingsError ? 'Shipping estimate' : 'Shipping'}</dt>
                <dd>{subtotal > 0 && shippingFee === 0 ? 'Free' : formatPrice(shippingFee)}</dd>
            </div>
            {Number.isSafeInteger(freeShippingThreshold) && freeShippingThreshold > subtotalPaise && subtotalPaise > 0 && (
                <p className='text-xs text-stone-500'>
                    Free shipping from {formatPrice(freeShippingThreshold / 100)}.
                </p>
            )}
            {siteSettingsError && (
                <p role='status' className='text-xs text-stone-500'>
                    Shipping settings could not be refreshed. The final shipping charge is recalculated by the server.
                </p>
            )}
            <div className='flex justify-between gap-4 border-t border-stone-300 pt-3 text-base text-rose-950'>
                <dt className='font-bold'>Total payable</dt>
                <dd className='font-bold'>{formatPrice(total)}</dd>
            </div>
      </dl>
    </div>
  )
}

export default CartTotal
