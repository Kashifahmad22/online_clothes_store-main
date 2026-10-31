import { useContext } from 'react'
import { ShopContext } from '../context/ShopContext'
import CollectionSection from './CollectionSection'

const BestSeller = () => {
  const { products } = useContext(ShopContext)
  return (
    <CollectionSection
      title='Handpicked favourites'
      description='Products marked as bestsellers by our team.'
      products={products.filter(product => product.bestseller).slice(0, 4)}
      linkLabel='Browse all products'
    />
  )
}

export default BestSeller
