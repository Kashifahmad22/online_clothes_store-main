import { useContext, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import CheckoutSummary from '../components/CheckoutSummary'
import { ShopContext } from '../context/ShopContext'
import axios from 'axios'
import { toast } from 'react-toastify'
import { openRazorpayCheckout } from '../utils/razorpayCheckout'
import { validateCheckoutAddress } from '../utils/checkoutValidation'
import {
    clearPendingCheckout, isRecoverableOrder, readPendingCheckout, savePendingCheckout
} from '../utils/pendingCheckout'

const Field = ({ label, name, error, hint, type = 'text', ...inputProps }) => (
    <div className='checkout-field'>
        <label htmlFor={`checkout-${name}`}>{label}</label>
        <input id={`checkout-${name}`} name={name} type={type}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `checkout-${name}-error` : hint ? `checkout-${name}-hint` : undefined}
            {...inputProps} />
        {!error && hint && <small id={`checkout-${name}-hint`}>{hint}</small>}
        {error && <small id={`checkout-${name}-error`} className='checkout-field__error'>{error}</small>}
    </div>
)

Field.propTypes = {
    label: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    error: PropTypes.string,
    hint: PropTypes.string,
    type: PropTypes.string
}

const PlaceOrder = () => {
    const {
        navigate, backendUrl, token, cartItems, setCartItems, refreshCart, products, siteSettings
    } = useContext(ShopContext)
    const [submitting, setSubmitting] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState('COD')
    const [pendingPaymentOrder, setPendingPaymentOrder] = useState(null)
    const [whatsappOptIn, setWhatsappOptIn] = useState(false)
    const [errors, setErrors] = useState({})
    const checkoutRequestKey = useRef(null)
    const codCheckoutRequestKey = useRef(null)
    const submitLock = useRef(false)
    const [summaryState, setSummaryState] = useState('loading')
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

    // The server removes only purchased quantities, so reload the cart rather than emptying it.
    const syncCart = async () => {
        if (refreshCart) await refreshCart()
        else setCartItems({})
    }

    // After a refresh, rebuild the pending payment from server state; stored ids are never trusted.
    useEffect(() => {
        if (!token) return undefined
        const stored = readPendingCheckout()
        if (!stored) return undefined
        if (stored.idempotencyKey) checkoutRequestKey.current = stored.idempotencyKey
        if (!stored.orderId) return undefined
        let cancelled = false
        ;(async () => {
            try {
                const list = await axios.post(`${backendUrl}/api/order/userorders`, {}, { headers: { token } })
                const order = (list.data.orders || []).find(item => item._id === stored.orderId)
                if (!isRecoverableOrder(order)) {
                    clearPendingCheckout()
                    checkoutRequestKey.current = null
                    return
                }
                const retry = await axios.post(`${backendUrl}/api/order/razorpay/retry`,
                    { orderId: stored.orderId }, { headers: { token } })
                if (cancelled) return
                if (!retry.data.success) throw new Error('not payable')
                setPaymentMethod('Razorpay')
                setPendingPaymentOrder(retry.data)
            } catch (error) {
                if (error.response) {
                    clearPendingCheckout()
                    checkoutRequestKey.current = null
                }
            }
        })()
        return () => { cancelled = true }
    }, [backendUrl, token])

    const onChangeHandler = event => {
        const { name, value } = event.target
        setFormData(data => ({ ...data, [name]: value }))
        setErrors(current => {
            if (!current[name]) return current
            const next = { ...current }
            delete next[name]
            return next
        })
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
                            await syncCart()
                            setPendingPaymentOrder(null)
                            checkoutRequestKey.current = null
                            clearPendingCheckout()
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
        if (submitting || submitLock.current) return
        if (!token) {
            navigate('/login', { state: { from: '/place-order' } })
            return
        }

        if (paymentMethod === 'Razorpay' && pendingPaymentOrder) {
            await resumePayment(pendingPaymentOrder.orderId)
            return
        }

        const validationErrors = validateCheckoutAddress(formData)
        if (Object.keys(validationErrors).length > 0) {
            setErrors(validationErrors)
            const firstInvalid = Object.keys(validationErrors)[0]
            document.getElementById(`checkout-${firstInvalid}`)?.focus()
            return
        }
        setErrors({})

        let items
        try {
            items = getOrderItems()
        } catch (error) {
            toast.error(error.message)
            navigate('/cart')
            return
        }

        submitLock.current = true
        setSubmitting(true)
        try {
            if (paymentMethod === 'Razorpay') {
                if (!checkoutRequestKey.current) {
                    checkoutRequestKey.current = crypto.randomUUID()
                }
                savePendingCheckout({ idempotencyKey: checkoutRequestKey.current })
                const response = await axios.post(
                    `${backendUrl}/api/order/razorpay`,
                    { items, address: formData, idempotencyKey: checkoutRequestKey.current, whatsappOptIn },
                    { headers: { token } }
                )
                if (!response.data.success) throw new Error(response.data.message || 'Unable to prepare online payment.')
                savePendingCheckout({ idempotencyKey: checkoutRequestKey.current, orderId: response.data.orderId })
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
            if (!response.data.success || !response.data.order?._id) {
                throw new Error(response.data.message || 'We could not confirm your order. Please check your orders before trying again.')
            }
            const placedOrder = response.data.order
            await syncCart()
            codCheckoutRequestKey.current = null
            toast.success('Order placed. Payment is due on delivery.')
            navigate(`/order-confirmation/${encodeURIComponent(placedOrder._id)}`, { state: { order: placedOrder } })
        } catch (error) {
            if (error.response?.status === 409 &&
                error.response?.data?.message?.includes('start a new checkout')) {
                checkoutRequestKey.current = null
                clearPendingCheckout()
            }
            toast.error(error.response?.data?.message || error.message || 'Unable to place order.')
        } finally {
            submitLock.current = false
            setSubmitting(false)
        }
    }

    return (
        <main className='shopping-page'>
        <form onSubmit={onSubmitHandler} noValidate className='checkout-form'>
            <div className='checkout-form__fields'>
                <h1 className='checkout-heading'>
                    {paymentMethod === 'Razorpay' ? 'Checkout: pay online' : 'Checkout: cash on delivery'}
                </h1>
                <p className='checkout-subheading'>Delivery information</p>
                <div className='checkout-row'>
                    <Field label='First name' name='firstName' value={formData.firstName} error={errors.firstName}
                        onChange={onChangeHandler} autoComplete='given-name' maxLength={80} />
                    <Field label='Last name' name='lastName' value={formData.lastName} error={errors.lastName}
                        onChange={onChangeHandler} autoComplete='family-name' maxLength={80} />
                </div>
                <Field label='Email address' name='email' type='email' value={formData.email} error={errors.email}
                    onChange={onChangeHandler} autoComplete='email' inputMode='email' maxLength={254} />
                <Field label='Mobile number' name='phone' type='tel' value={formData.phone} error={errors.phone}
                    onChange={onChangeHandler} autoComplete='tel' inputMode='tel' maxLength={15}
                    hint='10-digit Indian mobile number' />
                <Field label='Complete address' name='street' value={formData.street} error={errors.street}
                    onChange={onChangeHandler} autoComplete='street-address' maxLength={300} />
                <div className='checkout-row'>
                    <Field label='City' name='city' value={formData.city} error={errors.city}
                        onChange={onChangeHandler} autoComplete='address-level2' maxLength={100} />
                    <Field label='State' name='state' value={formData.state} error={errors.state}
                        onChange={onChangeHandler} autoComplete='address-level1' maxLength={100} />
                </div>
                <div className='checkout-row'>
                    <Field label='PIN code' name='zipcode' value={formData.zipcode} error={errors.zipcode}
                        onChange={onChangeHandler} autoComplete='postal-code' inputMode='numeric' maxLength={6} />
                    <Field label='Country' name='country' value={formData.country} readOnly onChange={onChangeHandler} />
                </div>
                {!siteSettings.checkout.serviceabilityCheckAvailable && (
                    <p className='text-xs text-stone-500'>
                        Online PIN-code serviceability checks are not available yet. Delivery availability is not confirmed by entering a PIN code.
                    </p>
                )}
                <label className='flex items-start gap-3 text-sm text-stone-700'>
                    <input type='checkbox' checked={whatsappOptIn} disabled={Boolean(pendingPaymentOrder)}
                        onChange={event => setWhatsappOptIn(event.target.checked)} className='mt-1 h-5 w-5' />
                    <span>Send my order updates on WhatsApp to this mobile number (optional).</span>
                </label>
            </div>

            <aside className='checkout-summary'>
                <h2 className='checkout-heading'>Order summary</h2>
                <CheckoutSummary onStatusChange={setSummaryState} />
                <fieldset className='mt-8'>
                    <legend className='checkout-heading'>Payment method</legend>
                    <label className={`checkout-option ${paymentMethod === 'COD' ? 'checkout-option--selected' : ''}`}>
                        <input type='radio' name='paymentMethod' value='COD'
                            checked={paymentMethod === 'COD'} disabled={Boolean(pendingPaymentOrder)}
                            onChange={() => setPaymentMethod('COD')} />
                        <span>
                            <strong>Cash on delivery</strong>
                            <small>Pay when your order is delivered.</small>
                        </span>
                    </label>
                    {siteSettings.checkout.prepaidAvailable && (
                        <label className={`checkout-option ${paymentMethod === 'Razorpay' ? 'checkout-option--selected' : ''}`}>
                            <input type='radio' name='paymentMethod' value='Razorpay'
                                checked={paymentMethod === 'Razorpay'} disabled={Boolean(pendingPaymentOrder)}
                                onChange={() => setPaymentMethod('Razorpay')} />
                            <span>
                                <strong>Pay online</strong>
                                <small>Pay now through the secure Razorpay window.</small>
                            </span>
                        </label>
                    )}
                    {!siteSettings.checkout.prepaidAvailable && (
                        <p className='mt-3 text-sm text-stone-600'>
                            Online payment is not available yet. Your order total is recalculated securely on the server.
                        </p>
                    )}
                    {pendingPaymentOrder && paymentMethod === 'Razorpay' && (
                        <p role='status' className='mt-3 text-sm text-amber-800'>
                            Your items are reserved until {new Date(pendingPaymentOrder.reservationExpiresAt).toLocaleTimeString('en-IN', {
                                hour: 'numeric', minute: '2-digit'
                            })}. Resume this payment to complete the order.
                        </p>
                    )}
                    {Object.keys(errors).length > 0 && (
                        <p role='alert' className='mt-4 text-sm text-red-800'>
                            Please correct the highlighted fields before continuing.
                        </p>
                    )}
                    <div className='mt-6'>
                        <button disabled={submitting || (summaryState === 'issues' && !pendingPaymentOrder)} type='submit' aria-busy={submitting}
                            className='min-h-12 w-full bg-rose-950 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-50'>
                            {submitting
                                ? 'Processing…'
                                : paymentMethod === 'COD'
                                    ? 'Place COD order'
                                    : pendingPaymentOrder
                                        ? 'Resume online payment'
                                        : 'Continue to payment'}
                        </button>
                    </div>
                </fieldset>
            </aside>
        </form>
        </main>
    )
}

export default PlaceOrder
