import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { policyPages } from '../config/policies'

const hasText = value => typeof value === 'string' && value.trim().length > 0
const formatRupees = paise => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2
}).format(paise / 100)
const policyPage = key => policyPages.find(page => page.key === key)

// Every statement here comes from public store settings or from checkout behaviour that already exists.
// Nothing is shown for a blank setting, and no delivery time, return window or serviceability is ever implied.
// Payment: `prepaidAvailable` is true only for Razorpay TEST-mode configuration (live keys are rejected by the
// backend) and the public settings expose no mode field, so an enabled online option is never advertised here.
const ProductTrustInfo = ({ settings, loaded, error }) => {
  if (!loaded && !error) return null

  if (error) {
    return (
      <section className='product-trust' aria-labelledby='product-trust-heading'>
        <h2 id='product-trust-heading' className='product-trust__heading'>Shipping, returns &amp; payment</h2>
        <p role='status' className='product-trust__note'>
          Store details could not be loaded right now. Shipping and payment details are confirmed at checkout.
        </p>
        <ul className='product-trust__links'>
          {['shipping', 'returns'].map(key => (
            <li key={key}><Link to={policyPage(key).path}>{policyPage(key).label}</Link></li>
          ))}
        </ul>
      </section>
    )
  }

  const policies = settings.policies || {}
  const shipping = settings.shipping || {}
  const checkout = settings.checkout || {}
  const support = settings.support || {}
  const fee = shipping.feePaise
  const threshold = shipping.freeShippingThresholdPaise
  const validFee = Number.isSafeInteger(fee) && fee >= 0
  const validThreshold = Number.isSafeInteger(threshold) && threshold > 0

  const policyLink = (key, linkLabel, missing) => hasText(policies[key])
    ? <Link to={policyPage(key).path}>{linkLabel}</Link>
    : <span className='product-trust__muted'>{missing}</span>

  return (
    <section className='product-trust' aria-labelledby='product-trust-heading'>
      <h2 id='product-trust-heading' className='product-trust__heading'>Shipping, returns &amp; payment</h2>
      <dl>
        <div>
          <dt>Shipping</dt>
          <dd>
            {validFee && (
              <p>{fee === 0 ? 'No shipping charge.' : `Shipping charge: ${formatRupees(fee)} per order.`}</p>
            )}
            {validFee && fee > 0 && validThreshold && <p>Free shipping on orders of {formatRupees(threshold)} or more.</p>}
            {hasText(shipping.message) && <p>{shipping.message.trim()}</p>}
            <p>{policyLink('shipping', 'Shipping & delivery policy', 'The shipping policy has not been published yet.')}</p>
          </dd>
        </div>
        <div>
          <dt>Returns</dt>
          <dd>
            <p>{policyLink('returns', 'Returns, exchanges & refund policy', 'The returns policy has not been published yet.')}</p>
          </dd>
        </div>
        <div>
          <dt>Payment</dt>
          <dd>
            {checkout.codAvailable && <p>Cash on delivery is offered as a payment option at checkout.</p>}
            {!checkout.prepaidAvailable && <p>Online payment is not available yet.</p>}
            <p>Available payment options are shown at checkout.</p>
          </dd>
        </div>
        <div>
          <dt>Support</dt>
          <dd>
            {hasText(support.phone) && <p>Phone: {support.phone.trim()}</p>}
            {hasText(support.email) && <p>Email: <a href={`mailto:${support.email.trim()}`}>{support.email.trim()}</a></p>}
            {hasText(support.businessHours) && <p>Hours: {support.businessHours.trim()}</p>}
            <p><Link to='/contact'>Contact us</Link></p>
          </dd>
        </div>
      </dl>
    </section>
  )
}

ProductTrustInfo.propTypes = {
  settings: PropTypes.shape({
    policies: PropTypes.object,
    shipping: PropTypes.object,
    checkout: PropTypes.object,
    support: PropTypes.object
  }).isRequired,
  loaded: PropTypes.bool,
  error: PropTypes.string
}

export default ProductTrustInfo
