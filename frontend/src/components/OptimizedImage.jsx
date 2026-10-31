import { useState } from 'react'
import PropTypes from 'prop-types'
import { resizedSrcSet, resizedUrl } from '../utils/images'

const DEFAULT_WIDTHS = [320, 480, 640, 960]

// Serves resized, auto-format Cloudinary images with responsive srcset and reserved space.
// If an optimised variant fails to load, it falls back to the original URL once.
const OptimizedImage = ({
  src, alt, widths = DEFAULT_WIDTHS, sizes = '100vw', width, height, priority = false, ...rest
}) => {
  const [failedSrc, setFailedSrc] = useState('')
  const srcSet = failedSrc === src ? null : resizedSrcSet(src, widths)
  const fallbackWidth = widths[Math.min(1, widths.length - 1)]

  return (
    <img
      src={srcSet ? resizedUrl(src, fallbackWidth) : src}
      srcSet={srcSet || undefined}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      {...(priority ? { fetchpriority: 'high' } : {})}
      decoding='async'
      onError={() => { if (srcSet) setFailedSrc(src) }}
      {...rest}
    />
  )
}

OptimizedImage.propTypes = {
  src: PropTypes.string.isRequired,
  alt: PropTypes.string.isRequired,
  widths: PropTypes.arrayOf(PropTypes.number),
  sizes: PropTypes.string,
  width: PropTypes.number,
  height: PropTypes.number,
  priority: PropTypes.bool
}

export default OptimizedImage
