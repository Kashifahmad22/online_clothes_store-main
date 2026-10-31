import { useContext, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'
import CampaignCard from '../components/CampaignCard'
import CollectionSection from '../components/CollectionSection'
import Hero from '../components/Hero'
import OptimizedImage from '../components/OptimizedImage'
import { campaigns } from '../config/campaigns'
import { getProductImage } from '../utils/productDisplay'
import { availableProductCategories } from '../config/productCategories'

const Home = () => {
  const { products, productsLoading, productsError, siteSettings } = useContext(ShopContext)
  const featuredProduct = products.find(product => getProductImage(product))
  const categories = useMemo(() => availableProductCategories(products)
    .map(category => ({
      name: category.label,
      path: `/category/${category.slug}`,
      product: products.find(item =>
        (category.type.startsWith('category:')
          ? item.category === category.label
          : item.productType === category.type) && getProductImage(item)
      ) || category.product
    }))
    .filter(item => item.product && getProductImage(item.product)), [products])
  const fabrics = useMemo(() => [...new Set(
    products.map(product => product.details?.fabric).filter(value => typeof value === 'string' && value.trim())
  )].map(name => ({
    name,
    product: products.find(item => item.details?.fabric === name && getProductImage(item))
  })).filter(item => item.product), [products])
  const campaignProducts = campaigns.map(campaign => ({
    campaign,
    product: products.find(product => (product.collections || []).includes(campaign.collectionTag))
  })).filter(item => item.product)
  const latestProducts = products.slice(0, 4)
  const latestProductIds = new Set(latestProducts.map(product => product._id))
  const bestsellers = products.filter(product =>
    product.bestseller && !latestProductIds.has(product._id)
  ).slice(0, 4)

  return (
    <main>
      <Hero product={featuredProduct} brand={siteSettings.brand} />

      {categories.length > 0 && (
        <section className='home-section'>
          <div className='section-heading'>
            <div>
              <p className='eyebrow'>A little something for every occasion</p>
              <h2>Shop by collection</h2>
            </div>
            <Link to='/collection' className='text-link'>View everything <span aria-hidden='true'>↗</span></Link>
          </div>
          <div className='category-grid'>
            {categories.slice(0, 5).map(({ name, path, product }) => {
              const image = getProductImage(product)
              return (
                <Link
                  key={name}
                  to={path}
                  className='category-tile'
                  aria-label={`Shop ${name}`}
                >
                  <OptimizedImage src={image.url} alt={image.altText || product.name}
                    widths={[240, 360, 480]} sizes='(min-width: 1024px) 25vw, 50vw' />
                  <span className='category-tile__shade' />
                  <span className='category-tile__label'>{name}<span aria-hidden='true'>↗</span></span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {fabrics.length > 0 && (
        <section className='home-section'>
          <div className='section-heading'>
            <div>
              <p className='eyebrow'>Browse by fabric</p>
              <h2>Find your favourite weave</h2>
            </div>
            <Link to='/collection' className='text-link'>Shop all fabrics <span aria-hidden='true'>↗</span></Link>
          </div>
          <div className='category-grid'>
            {fabrics.slice(0, 5).map(({ name, product }) => {
              const image = getProductImage(product)
              return (
                <Link key={name} to={`/collection?fabric=${encodeURIComponent(name)}`}
                  className='category-tile' aria-label={`Shop ${name} products`}>
                  <OptimizedImage src={image.url} alt={image.altText || product.name}
                    widths={[240, 360, 480]} sizes='(min-width: 1024px) 25vw, 50vw' />
                  <span className='category-tile__shade' />
                  <span className='category-tile__label'>{name}<span aria-hidden='true'>↗</span></span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {campaignProducts.length > 0 && (
        <section className='home-section home-section--campaigns'>
          <div className='section-heading'>
            <div>
              <p className='eyebrow'>Made for the season</p>
              <h2>Festive collections</h2>
            </div>
          </div>
          <div className='campaign-grid'>
            {campaignProducts.map(({ campaign, product }) => (
              <CampaignCard key={campaign.slug} campaign={campaign} product={product} />
            ))}
          </div>
        </section>
      )}

      {productsError && (
        <p role='alert' className='my-6 border border-red-200 bg-red-50 p-4 text-sm text-red-900'>
          The catalogue could not be loaded. Please try again shortly.
        </p>
      )}

      <CollectionSection
        title='Just arrived'
        description='The latest additions to our live catalogue.'
        products={latestProducts}
      />
      <CollectionSection
        title='Featured collection'
        description='Pieces selected by our team from the live catalogue.'
        products={bestsellers}
        linkLabel='Explore our collection'
      />

      {!productsLoading && !productsError && products.length === 0 && (
        <div className='catalogue-empty'>
          <p className='eyebrow'>PSH Sarees & Ethnic Wear</p>
          <h2>Our online collection is taking shape.</h2>
          <p>Our catalogue is being updated. Please check back soon.</p>
          <Link to='/contact' className='button button--wine'>
            Contact us
          </Link>
        </div>
      )}

      {productsLoading && <p className='py-8 text-center text-sm text-stone-600'>Loading the latest catalogue…</p>}
      <section className='brand-note'>
        <div className='brand-note__monogram' aria-hidden='true'>P<span>S</span>H</div>
        <div className='brand-note__copy'>
          <p className='eyebrow'>{siteSettings.brand.tagline}</p>
          <h2>{siteSettings.brand.publicName}</h2>
          <p>{siteSettings.brand.description}</p>
          <Link to='/about' className='text-link'>Our story <span aria-hidden='true'>↗</span></Link>
        </div>
        <div className='brand-note__trust'>
          <div><span className='brand-note__mark'>01</span><p>Cash on delivery<br /><small>Available at checkout</small></p></div>
          <div><span className='brand-note__mark'>02</span><p>Clear product details<br /><small>Shown when supplied</small></p></div>
          <div><span className='brand-note__mark'>03</span><p>Customer support<br /><small><Link to='/contact'>Contact us</Link></small></p></div>
        </div>
      </section>
    </main>
  )
}

export default Home
