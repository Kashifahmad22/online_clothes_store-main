import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'

const PromotionBanner = ({ eyebrow, title, description, to, actionLabel, image }) => (
  <section className='promotion-banner relative isolate overflow-hidden text-white'>
    {image && (
      <>
        <img className='absolute inset-0 -z-20 h-full w-full object-cover' src={image} alt='' />
        <div className='promotion-banner__shade absolute inset-0 -z-10' />
      </>
    )}
    {!image && <div className='promotion-banner__fallback absolute inset-0 -z-10' />}
    <div className='promotion-banner__copy max-w-2xl px-6 py-10 sm:px-10 sm:py-14'>
      {eyebrow && <p className='eyebrow mb-2 text-amber-100'>{eyebrow}</p>}
      <h2 className='font-serif text-4xl leading-tight sm:text-6xl'>{title}</h2>
      {description && <p className='mt-3 max-w-lg text-sm leading-6 text-white/90 sm:text-base'>{description}</p>}
      {to && actionLabel && (
        <Link to={to} className='button button--gold mt-6'>
          {actionLabel}
        </Link>
      )}
    </div>
  </section>
)

PromotionBanner.propTypes = {
  eyebrow: PropTypes.string,
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  to: PropTypes.string,
  actionLabel: PropTypes.string,
  image: PropTypes.string
}

export default PromotionBanner
