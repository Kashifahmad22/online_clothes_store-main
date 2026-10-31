import { useContext, useEffect, useRef, useState } from 'react'
import Title from '../components/Title'
import CartTotal from '../components/CartTotal'
import { ShopContext } from '../context/ShopContext'
import axios from 'axios'
import { toast } from 'react-toastify'
import { openRazorpayCheckout } from '../utils/razorpayCheckout'

const PlaceOrder = () => {
    const {
        navigate, backendUrl, token, cartItems, setCartItems, products, siteSettings
    } = useContext(ShopContext)
    const [submitting, setSubmitting] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState('COD')
    const [pendingPaymentOrder, setPendingPaymentOrder] = useState(null)
    const [whatsappOptIn, setWhatsappOptIn] = useState(false)
    const checkoutRequestKey = useRef(null)
    const codCheckoutRequestKey = useRef(null)
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        street: '',
        city: '',
        state: '',
        zipcode: '',
        country: 'India',
        phone: ''
    })

    useEffect(() => {
        if (!token) navigate('/login', { replace: true, state: { from: '/place-order' } })
    }, [navigate, token])

    const onChangeHandler = event => {
        setFormData(data => ({ ...data, [event.target.name]: event.target.value }))
    }

    const getOrderItems = () => {
        const items = []
        for (const productId of Object.keys(cartItems)) {
            for (const variantId of Object.keys(cartItems[productId])) {
                const quantity = cartItems[productId][variantId]
                const product = products.find(item => item._id === productId)
                const variant = product?.variants?.find(item => item._id === variantId)
                if (!variant || !Number.isSafeInteger(quantity) || quantity < 1) {
                    throw new Error('Your cart has an unavailable item. Please review it before ordering.')
                }
                items.push({ productId, variantId, quantity })
            }
        }
        if (items.length === 0) throw new Error('Your cart is empty.')
        return items
    }

    const openPayment = async paymentOrder => {
        setSubmitting(true)
        try {
            await openRazorpayCheckout({
                paymentOrder,
                onSuccess: async payment => {
                    try {
                        const response = await axios.post(
                            `${backendUrl}/api/order/verifyRazorpay`,
                            { orderId: paymentOrder.orderId, ...payment },
                            { headers: { token } }
                        )
                        if (response.data.success && response.data.paymentStatus === 'paid') {
                            setCartItems({})
                            setPendingPaymentOrder(null)
                            checkoutRequestKey.current = null
                            toast.success(response.data.message || 'Payment confirmed.')
                            navigate('/orders')
                            return
                        }
                        setPendingPaymentOrder(paymentOrder)
                        toast.info(response.data.message || 'Payment is still processing. Check your orders shortly.')
                    } catch (error) {
                        setPendingPaymentOrder(paymentOrder)
                        toast.error(error.response?.data?.message ||
                            'Payment status could not be confirmed. Check your orders before trying again.')
                    } finally {
                        setSubmitting(false)
                    }
                },
                onFailure: event => {
                    setSubmitting(false)
                    setPendingPaymentOrder(paymentOrder)
                    toast.error(event.error?.description || 'Payment did not complete. You can retry before the reservation expires.')
                },
                onDismiss: () => {
                    setSubmitting(false)
                    setPendingPaymentOrder(paymentOrder)
                }
            })
        } catch (error) {
            setSubmitting(false)
            setPendingPaymentOrder(paymentOrder)
            toast.error(error.message || 'Unable to open the secure payment window.')
        }
    }

    const resumePayment = async orderId => {
        setSubmitting(true)
        try {
            const response = await axios.post(
                `${backendUrl}/api/order/razorpay/retry`,
                { orderId },
                { headers: { token } }
            )
            if (!response.data.success) throw new Error(response.data.message || 'Unable to resume payment.')
            setPendingPaymentOrder(response.data)
            setSubmitting(false)
            await openPayment(response.data)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message || 'Unable to resume payment.')
            setSubmitting(false)
        }
    }

    const onSubmitHandler = async event => {
        event.preventDefault()
        if (submitting) return
        if (!token) {
            navigate('/login', { state: { from: '/place-order' } })
            return
        }

        if (paymentMethod === 'Razorpay' && pendingPaymentOrder) {
            await resumePayment(pendingPaymentOrder.orderId)
            return
        }

        let items
        try {
            items = getOrderItems()
        } catch (error) {
            toast.error(error.message)
            navigate('/cart')
            return
        }

        setSubmitting(true)
        try {
            if (paymentMethod === 'Razorpay') {
                if (!checkoutRequestKey.current) {
                    checkoutRequestKey.current = crypto.randomUUID()
                }
                const response = await axios.post(
                    `${backendUrl}/api/order/razorpay`,
                    { items, address: formData, idempotencyKey: checkoutRequestKey.current, whatsappOptIn },
                    { headers: { token } }
                )
                if (!response.data.success) throw new Error(response.data.message || 'Unable to prepare online payment.')
                setPendingPaymentOrder(response.data)
                setSubmitting(false)
                await openPayment(response.data)
                return
            }

            const response = await axios.post(
                `${backendUrl}/api/order/place`,
                {
                    items,
                    address: formData,
                    whatsappOptIn,
                    idempotencyKey: codCheckoutRequestKey.current ||
                        (codCheckoutRequestKey.current = crypto.randomUUID())
                },
                { headers: { token } }
            )
            if (!response.data.success) throw new Error(response.data.message)
            setCartItems({})
            codCheckoutRequestKey.current = null
            toast.success('Order placed. Payment is due on delivery.')
            navigate('/orders')
        } catch (error) {
            if (error.response?.status === 409 &&
                error.response?.data?.message?.includes('start a new checkout')) {
                checkoutRequestKey.current = null
            }
            toast.error(error.response?.data?.message || error.message || 'Unable to place order.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <form onSubmit={onSubmitHandler} className='flex flex-col sm:flex-row justify-between gap-4 pt-5 sm:pt-14 min-h-[80vh] border-t'>
            <div className='flex flex-col gap-4 w-full sm:max-w-[480px]'>
                <div className='text-xl sm:text-2xl my-3'>
                    <Title text1={'DELIVERY'} text2={'INFORMATION'} />
                </div>
                <div className='flex gap-3'>
                    <input required onChange={onChangeHandler} name='firstName' value={formData.firstName}
                        className='w-full rounded-sm border border-stone-300 px-3.5 py-3' type='text' maxLength={80} placeholder='First name' />
                    <input required onChange={onChangeHandler} name='lastName' value={formData.lastName}
                        className='w-full rounded-sm border border-stone-300 px-3.5 py-3' type='text' maxLength={80} placeholder='Last name' />
                </div>
                <input required onChange={onChangeHandler} name='email' value={formData.email}
                    className='w-full rounded-sm border border-stone-300 px-3.5 py-3' type='email' maxLength={254} placeholder='Email address' />
                <input required onChange={onChangeHandler} name='street' value={formData.street}
                    className='w-full rounded-sm border border-stone-300 px-3.5 py-3' type='text' maxLength={300} placeholder='Complete address' />
                <div className='flex gap-3'>
                    <input required onChange={onChangeHandler} name='city' value={formData.city}
                        className='w-full rounded-sm border border-stone-300 px-3.5 py-3' type='text' maxLength={100} placeholder='City' />
                    <input required onChange={onChangeHandler} name='state' value={formData.state}
                        className='w-full rounded-sm border border-stone-300 px-3.5 py-3' type='text' maxLength={100} placeholder='State' />
                </div>
                <div className='flex gap-3'>
                    <input required onChange={onChangeHandler} name='zipcode' value={formData.zipcode}
                        className='w-full rounded-sm border border-stone-300 px-3.5 py-3' type='text' inputMode='numeric' pattern='[0-9]{6}' maxLength={6} placeholder='PIN code' />
                    <input required onChange={onChangeHandler} name='country' value={formData.country}
                        className='w-full rounded-sm border border-stone-300 bg-stone-100 px-3.5 py-3' type='text' readOnly />
                </div>
                {!siteSettings.checkout.serviceabilityCheckAvailable && (
                    <p className='text-xs text-stone-500'>
                        Online PIN-code serviceability checks are not available yet. Delivery availability is not confirmed by entering a PIN code.
                    </p>
                )}
                <input required onChange={onChangeHandler} name='phone' value={formData.phone}
                    className='w-full rounded-sm border border-stone-300 px-3.5 py-3' type='tel' inputMode='tel' maxLength={15} placeholder='Mobile number' />
                <label className='flex items-start gap-3 text-sm text-stone-700'>
                    <input type='checkbox' checked={whatsappOptIn} disabled={Boolean(pendingPaymentOrder)}
                        onChange={event => setWhatsappOptIn(event.target.checked)} className='mt-1' />
                    <span>Send my order updates on WhatsApp to this mobile number (optional).</span>
                </label>
            </div>

            <div className='mt-8'>
                <div className='mt-8 w-full sm:min-w-80'><CartTotal /></div>
                <div className='mt-12'>
                    <Title text1={'PAYMENT'} text2={'METHOD'} />
                    <label className='mt-4 flex cursor-pointer items-center gap-3 border p-3 text-sm'>
                        <input type='radio' name='paymentMethod' value='COD'
                            checked={paymentMethod === 'COD'} disabled={Boolean(pendingPaymentOrder)}
                            onChange={() => setPaymentMethod('COD')} />
                        Cash on delivery
                    </label>
                    {siteSettings.checkout.prepaidAvailable && (
                        <label className='mt-2 flex cursor-pointer items-center gap-3 border p-3 text-sm'>
                            <input type='radio' name='paymentMethod' value='Razorpay'
                                checked={paymentMethod === 'Razorpay'} disabled={Boolean(pendingPaymentOrder)}
                                onChange={() => setPaymentMethod('Razorpay')} />
                            Pay online securely
                        </label>
                    )}
                    {!siteSettings.checkout.prepaidAvailable && (
                        <p className='mt-3 text-sm text-gray-500'>
                            Online payment is not available yet. Your order total is recalculated securely on the server.
                        </p>
                    )}
                    {pendingPaymentOrder && paymentMethod === 'Razorpay' && (
                        <p className='mt-3 text-sm text-amber-800'>
                            Your items are reserved until {new Date(pendingPaymentOrder.reservationExpiresAt).toLocaleTimeString('en-IN', {
                                hour: 'numeric', minute: '2-digit'
                            })}. Resume this payment to complete the order.
                        </p>
                    )}
                    <div className='w-full text-end mt-8'>
                        <button disabled={submitting} type='submit'
                            className='min-h-12 bg-rose-950 px-10 py-3 text-sm font-semibold text-white disabled:opacity-50'>
                            {submitting
                                ? 'PROCESSING...'
                                : paymentMethod === 'COD'
                                    ? 'PLACE COD ORDER'
                                    : pendingPaymentOrder
                                        ? 'RESUME ONLINE PAYMENT'
                                        : 'CONTINUE TO PAYMENT'}
                        </button>
                    </div>
                </div>
            </div>
        </form>
    )
}

export default PlaceOrder
