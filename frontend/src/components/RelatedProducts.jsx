import { useContext, useMemo } from 'react'
import PropTypes from 'prop-types'
import { ShopContext } from '../context/ShopContext'
import CollectionSection from './CollectionSection'

const RelatedProducts = ({ product }) => {
  const { products } = useContext(ShopContext)
  const related = useMemo(() => products.filter(item =>
    item._id !== product._id &&
    (item.category === product.category || (item.collections || []).some(collection =>
      (product.collections || []).includes(collection)))
  ).slice(0, 4), [products, product])

  return (
    <CollectionSection
      title='You may also like'
      description='More products from our catalogue.'
      products={related}
    />
  )
}

RelatedProducts.propTypes = {
  product: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    category: PropTypes.string,
    collections: PropTypes.arrayOf(PropTypes.string)
  }).isRequired
}

export default RelatedProducts
