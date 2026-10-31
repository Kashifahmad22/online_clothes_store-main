import { useContext } from 'react'
import { ShopContext } from '../context/ShopContext'
import CollectionSection from './CollectionSection'

const LatestCollection = () => {
  const { products } = useContext(ShopContext)
  return (
    <CollectionSection
      title='Recently added'
      description='Browse the latest products listed in our catalogue.'
      products={products.slice(0, 4)}
    />
  )
}

export default LatestCollection
