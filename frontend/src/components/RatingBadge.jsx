import PropTypes from 'prop-types'
import { ratingLabel } from '../utils/ratings'

const Star = ({ fill }) => (
  <svg viewBox='0 0 20 20' className='h-4 w-4' aria-hidden='true' focusable='false'>
    <defs>
      <linearGradient id={`star-${fill}`}>
        <stop offset={`${fill}%`} stopColor='#b45309' />
        <stop offset={`${fill}%`} stopColor='#d6d3d1' />
      </linearGradient>
    </defs>
    <path fill={`url(#star-${fill})`} d='M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L10 14.9l-5.2 2.8 1-5.9L1.5 7.7l5.9-.8z' />
  </svg>
)
Star.propTypes = { fill: PropTypes.number.isRequired }

// Renders nothing unless there is a real, positive review count.
export const RatingBadge = ({ summary, className = '' }) => {
  if (!summary || !(summary.count > 0)) return null
  return (
    <p className={`inline-flex items-center gap-1 text-xs font-medium text-stone-800 ${className}`}
      role='img' aria-label={ratingLabel(summary.average, summary.count)}>
      <span aria-hidden='true' className='text-amber-700'>★</span>
      <span aria-hidden='true'>{summary.average.toFixed(1)} ({summary.count})</span>
    </p>
  )
}
RatingBadge.propTypes = {
  summary: PropTypes.shape({ count: PropTypes.number, average: PropTypes.number }),
  className: PropTypes.string
}

export const RatingStars = ({ value, label }) => (
  <span className='inline-flex' role='img' aria-label={label || `${value} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map(n => <Star key={n} fill={Math.round(Math.max(0, Math.min(1, value - (n - 1))) * 100)} />)}
  </span>
)
RatingStars.propTypes = { value: PropTypes.number.isRequired, label: PropTypes.string }
