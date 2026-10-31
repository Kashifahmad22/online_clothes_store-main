const CHECKOUT_SCRIPT_ID = 'razorpay-checkout-script'
const CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

export const loadRazorpayCheckout = () => {
    if (window.Razorpay) return Promise.resolve(window.Razorpay)

    return new Promise((resolve, reject) => {
        let script = document.getElementById(CHECKOUT_SCRIPT_ID)
        const handleLoad = () => {
            if (window.Razorpay) resolve(window.Razorpay)
            else reject(new Error('Online payment could not be initialized.'))
        }
        const handleError = () => {
            script.dataset.loadFailed = 'true'
            reject(new Error('Unable to load the secure payment window.'))
        }

        if (script?.dataset.loadFailed === 'true') {
            reject(new Error('Unable to load the secure payment window. Refresh and try again.'))
            return
        }
        if (!script) {
            script = document.createElement('script')
            script.id = CHECKOUT_SCRIPT_ID
            script.src = CHECKOUT_SCRIPT_URL
            script.async = true
            document.body.appendChild(script)
        }
        script.addEventListener('load', handleLoad, { once: true })
        script.addEventListener('error', handleError, { once: true })
    })
}

export const openRazorpayCheckout = async ({ paymentOrder, onSuccess, onFailure, onDismiss }) => {
    const Razorpay = await loadRazorpayCheckout()
    const checkout = new Razorpay({
        key: paymentOrder.keyId,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        name: 'Patna Saree Handloom',
        order_id: paymentOrder.razorpayOrderId,
        prefill: paymentOrder.prefill,
        theme: { color: '#651d32' },
        handler: onSuccess,
        modal: { ondismiss: onDismiss }
    })
    checkout.on('payment.failed', onFailure)
    checkout.open()
}
