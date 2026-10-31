import { useContext } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'
import { storefrontCategories, isUpcomingStorefrontCategory } from '../config/productCategories'
import Collection from './Collection'

const CategoryPage = () => {
  const { categorySlug } = useParams()
  const { products, productsLoading, productsError } = useContext(ShopContext)
  const upcomingCandidate = storefrontCategories.find(category => category.slug === categorySlug && !category.alwaysAvailable)

  if (!upcomingCandidate || productsError) return <Collection mode='category' />
  if (productsLoading) {
    return <main className='collection-page'><p role='status' className='py-20 text-center text-sm text-stone-600'>Loading…</p></main>
  }
  if (!isUpcomingStorefrontCategory(categorySlug, products)) return <Collection mode='category' />

  return (
    <main className='collection-page'>
      <header className='collection-heading category-coming-soon'>
        <p className='eyebrow'>PSH Sarees &amp; Ethnic Wear</p>
        <h1>{upcomingCandidate.label}</h1>
        <span className='coming-soon-badge'>Coming soon</span>
        <p>Our {upcomingCandidate.label.toLowerCase()} collection is being prepared. In the meantime, explore what is available now.</p>
        <div className='category-coming-soon__actions'>
          <Link to='/category/sarees' className='button button--wine'>Shop sarees</Link>
          <Link to='/' className='category-coming-soon__home'>Back to home</Link>
        </div>
      </header>
    </main>
  )
}

export default CategoryPage
