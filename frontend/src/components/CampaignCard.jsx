import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { getProductImage } from '../utils/productDisplay'

const CampaignCard = ({ campaign, product }) => {
  const image = getProductImage(product)
  if (!image) return null

  return (
    <Link
      to={`/collections/${campaign.slug}`}
      className={`campaign-card campaign-card--${campaign.slug} group relative isolate flex aspect-[4/3] items-end overflow-hidden text-white sm:aspect-[5/3]`}
    >
      <img
        src={image.url}
        alt={image.altText || product.name}
        className='absolute inset-0 -z-20 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]'
        loading='lazy'
      />
      <div className='campaign-card__shade absolute inset-0 -z-10' />
      <div className='campaign-card__copy p-4 sm:p-6'>
        <p className='eyebrow text-white/85'>{campaign.eyebrow}</p>
        <h3 className='mt-1 font-serif text-3xl sm:text-4xl'>{campaign.name}</h3>
        <span className='mt-3 inline-block text-sm font-semibold underline decoration-amber-300 underline-offset-4'>
          Explore collection
        </span>
      </div>
    </Link>
  )
}

CampaignCard.propTypes = {
  campaign: PropTypes.shape({
    slug: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    eyebrow: PropTypes.string.isRequired
  }).isRequired,
  product: PropTypes.shape({
    name: PropTypes.string.isRequired,
    images: PropTypes.arrayOf(PropTypes.shape({
      url: PropTypes.string,
      role: PropTypes.string,
      altText: PropTypes.string,
      order: PropTypes.number
    }))
  }).isRequired
}

export default CampaignCard
