import { useContext } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'
import { storefrontCategories, isUpcomingStorefrontCategory } from '../config/productCategories'
import { resolveCategorySlug } from '../config/canonicalCategories'
import Collection from './Collection'

const CategoryPage = () => {
  const { categorySlug } = useParams()
  const { products, productsLoading, productsError, refreshProducts } = useContext(ShopContext)
  // Legacy slugs (e.g. suit-pants) resolve to their canonical category; unknown slugs fall through to the collection.
  const canonicalSlug = resolveCategorySlug(categorySlug)?.category.slug
  const upcomingCandidate = storefrontCategories.find(category => category.slug === canonicalSlug && !category.alwaysAvailable)

  if (!upcomingCandidate) return <Collection mode='category' />
  if (productsLoading) {
    return <main className='collection-page'><p role='status' className='py-20 text-center text-sm text-stone-600'>Loading…</p></main>
  }
  // Without a loaded catalogue we cannot tell an empty category from a failed request, so never say "Coming soon".
  if (productsError) {
    return (
      <main className='collection-page'>
        <header className='collection-heading category-coming-soon'>
          <p className='eyebrow'>PSH Sarees &amp; Ethnic Wear</p>
          <h1>{upcomingCandidate.label}</h1>
          <p role='alert'>We could not load this category right now. Please check your connection and try again.</p>
          <div className='category-coming-soon__actions'>
            <button type='button' onClick={refreshProducts} className='button button--wine'>Try again</button>
            <Link to='/category/sarees' className='category-coming-soon__home'>Shop sarees</Link>
            <Link to='/' className='category-coming-soon__home'>Back to home</Link>
          </div>
        </header>
      </main>
    )
  }
  if (!isUpcomingStorefrontCategory(canonicalSlug, products)) return <Collection mode='category' />

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
