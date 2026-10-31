import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import ProductPrice from './ProductPrice'
import OptimizedImage from './OptimizedImage'
import { getAvailableStock, getProductImage, getStartingPrice } from '../utils/productDisplay'

const ProductItem = ({ product }) => {
  const image = getProductImage(product)
  const price = getStartingPrice(product)
  const availableStock = getAvailableStock(product)
  const mrp = Number.isFinite(product.mrp) && product.mrp > price ? product.mrp : null

  return (
    <Link
      onClick={() => window.scrollTo(0, 0)}
      className='product-card group min-w-0'
      to={`/product/${product.slug || product._id}`}
      aria-label={`View ${product.name}`}
    >
      <div className='product-card__image'>
        {image && (
          <OptimizedImage
            className='h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]'
            src={image.url}
            alt={image.altText || product.name}
            widths={[240, 360, 480, 720]}
            sizes='(min-width: 1024px) 25vw, 50vw'
          />
        )}
        {mrp && <span className='product-card__badge'>{Math.round((mrp - price) / mrp * 100)}% off</span>}
        {!availableStock && <span className='product-card__sold-out'>Unavailable</span>}
      </div>
      <div className='product-card__details'>
        <p className='line-clamp-2 min-h-10 text-sm font-medium leading-5 text-stone-900 sm:text-base'>
          {product.name}
        </p>
        <ProductPrice price={price} mrp={mrp} compact />
      </div>
    </Link>
  )
}

ProductItem.propTypes = {
  product: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    slug: PropTypes.string,
    name: PropTypes.string.isRequired,
    images: PropTypes.arrayOf(PropTypes.shape({
      url: PropTypes.string,
      role: PropTypes.string,
      altText: PropTypes.string,
      order: PropTypes.number
    })),
    price: PropTypes.number,
    mrp: PropTypes.number,
    variants: PropTypes.arrayOf(PropTypes.shape({
      active: PropTypes.bool,
      stockOnHand: PropTypes.number,
      reserved: PropTypes.number,
      price: PropTypes.number
    }))
  }).isRequired
}

export default ProductItem
