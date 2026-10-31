import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'

const ProductGallery = ({ images, productName }) => {
  const [selectedImage, setSelectedImage] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const image = images[selectedImage] || images[0]

  useEffect(() => {
    if (!zoomed) return undefined
    const closeOnEscape = event => {
      if (event.key === 'Escape') setZoomed(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [zoomed])

  if (!image) {
    return <div className='product-gallery__fallback' role='img' aria-label={`${productName} image unavailable`} />
  }

  return (
    <div className='product-gallery'>
      <div className='product-gallery__thumbs'>
        {images.map((item, index) => (
          <button
            type='button'
            key={`${item.url}-${index}`}
            onClick={() => setSelectedImage(index)}
            aria-label={`View ${item.role || 'product'} image ${index + 1}`}
            aria-pressed={selectedImage === index}
            className={`product-gallery__thumb ${selectedImage === index ? 'product-gallery__thumb--selected' : ''}`}
          >
            <img className='h-full w-full object-cover' src={item.url} alt={item.altText || `${productName} ${item.role || 'detail'}`} />
          </button>
        ))}
      </div>
      <div className='product-gallery__main'>
        <button type='button' className='product-gallery__zoom-trigger' onClick={() => setZoomed(true)}
          aria-label='View product image larger'>
          <img
            className='h-full w-full object-cover'
            src={image.url}
            alt={image.altText || `${productName}${image.role ? ` - ${image.role.replace('-', ' ')}` : ''}`}
          />
          <span>Tap to enlarge</span>
        </button>
      </div>
      {zoomed && (
        <div className='product-lightbox' role='dialog' aria-modal='true' aria-label={`${productName} product image`}
          onClick={() => setZoomed(false)}>
          <button type='button' className='product-lightbox__close' onClick={() => setZoomed(false)}
            aria-label='Close enlarged image'>×</button>
          <img src={image.url} alt={image.altText || productName} onClick={event => event.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

ProductGallery.propTypes = {
  images: PropTypes.arrayOf(PropTypes.shape({
    url: PropTypes.string.isRequired,
    role: PropTypes.string,
    altText: PropTypes.string,
    order: PropTypes.number
  })).isRequired,
  productName: PropTypes.string.isRequired
}

export default ProductGallery
