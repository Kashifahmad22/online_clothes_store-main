import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import ProductItem from './ProductItem'

const CollectionSection = ({ title, description, products, to = '/collection', linkLabel = 'View collection' }) => {
  if (!products.length) return null

  return (
    <section className='home-section'>
      <div className='section-heading'>
        <div>
          <p className='eyebrow'>PSH Sarees & Ethnic Wear</p>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <Link to={to} className='text-link'>
          {linkLabel}
        </Link>
      </div>
      <div className={`product-grid ${products.length === 1 ? 'product-grid--single' : ''}`}>
        {products.map(product => <ProductItem key={product._id} product={product} />)}
      </div>
    </section>
  )
}

CollectionSection.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  products: PropTypes.arrayOf(PropTypes.shape({
    _id: PropTypes.string.isRequired
  })).isRequired,
  to: PropTypes.string,
  linkLabel: PropTypes.string
}

export default CollectionSection
