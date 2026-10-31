import { useContext } from 'react'
import { ShopContext } from '../context/ShopContext'
import Title from './Title';

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
      <div className='text-2xl'>
        <Title text1={'CART'} text2={'TOTALS'} />
      </div>

      <div className='mt-2 flex flex-col gap-3 text-sm text-stone-700'>
            <div className='flex justify-between gap-4'>
                <p>Subtotal</p>
                <p>{formatPrice(subtotal)}</p>
            </div>
            <hr className='border-stone-200' />
            <div className='flex justify-between gap-4'>
                <p>{siteSettingsError ? 'Shipping estimate' : 'Shipping Fee'}</p>
                <p>{formatPrice(shippingFee)}</p>
            </div>
            {Number.isSafeInteger(freeShippingThreshold) && freeShippingThreshold > subtotalPaise && (
                <p className='text-xs text-stone-500'>
                    Free shipping from {formatPrice(freeShippingThreshold / 100)}.
                </p>
            )}
            {siteSettingsError && (
                <p role='status' className='text-xs text-stone-500'>
                    Shipping settings could not be refreshed. The final shipping charge is recalculated by the server.
                </p>
            )}
            <hr className='border-stone-200' />
            <div className='flex justify-between gap-4 text-base text-rose-950'>
                <b>Total</b>
                <b>{formatPrice(total)}</b>
            </div>
      </div>
    </div>
  )
}

export default CartTotal
