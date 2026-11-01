import PropTypes from 'prop-types'
import { MERCHANDISING_BADGE_LABELS, getMerchandisingBadges } from '../utils/productDisplay'

const MerchandisingBadges = ({ product, className = '', hideLowStock = false }) => {
  const badges = getMerchandisingBadges(product).filter(badge => !(hideLowStock && badge === 'low-stock'))
  if (badges.length === 0) return null
  return (
    <ul className={`merch-badges ${className}`.trim()}>
      {badges.map(badge => (
        <li key={badge} className={`merch-badge merch-badge--${badge}`}>{MERCHANDISING_BADGE_LABELS[badge]}</li>
      ))}
    </ul>
  )
}

MerchandisingBadges.propTypes = {
  product: PropTypes.shape({
    bestseller: PropTypes.bool,
    fastSelling: PropTypes.bool,
    lowStock: PropTypes.bool
  }).isRequired,
  className: PropTypes.string,
  hideLowStock: PropTypes.bool
}

export default MerchandisingBadges
