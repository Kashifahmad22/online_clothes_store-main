import { useContext, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'
import ProductItem from '../components/ProductItem'
import PromotionBanner from '../components/PromotionBanner'
import { campaigns, campaignBySlug, categoryFromSlug } from '../config/campaigns'
import { categoryForSlug, productCategories } from '../config/productCategories'

const PAGE_SIZE = 12
const SORTS = ['newest', 'price-asc', 'price-desc']
const EMPTY_FACETS = { categories: [], productTypes: [], fabrics: [], colours: [], occasions: [] }
const PRODUCT_TYPES = Object.fromEntries(productCategories.map(category => [
  category.slug,
  { value: category.type, label: category.label }
]))

const CatalogueSelect = ({ label, value, options, onChange, allLabel }) => (
  <label className='catalogue-filter'>
    <span>{label}</span>
    <select value={value} onChange={event => onChange(event.target.value)}>
      <option value=''>{allLabel}</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
)

CatalogueSelect.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired
  })).isRequired,
  onChange: PropTypes.func.isRequired,
  allLabel: PropTypes.string.isRequired
}

const Collection = ({ mode = 'all' }) => {
  const { backendUrl } = useContext(ShopContext)
  const navigate = useNavigate()
  const { campaignSlug, categorySlug: routeCategory } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const campaign = mode === 'campaign' ? campaignBySlug(campaignSlug) : null
  const productType = mode === 'category'
    ? categoryForSlug(routeCategory)?.type || ''
    : searchParams.get('productType') || ''
  const category = mode === 'category' && !productType
    ? categoryFromSlug(routeCategory || '')
    : searchParams.get('category') || ''
  const queryString = searchParams.toString()
  const query = useMemo(() => new URLSearchParams(queryString), [queryString])
  const page = Math.max(1, Number(query.get('page')) || 1)
  const sort = SORTS.includes(query.get('sort')) ? query.get('sort') : 'newest'
  const search = query.get('search') || ''
  const fabric = query.get('fabric') || ''
  const colour = query.get('colour') || ''
  const occasion = query.get('occasion') || ''
  const minPrice = query.get('minPrice') || ''
  const maxPrice = query.get('maxPrice') || ''
  const availableOnly = query.get('availableOnly') === 'true'
  const [items, setItems] = useState([])
  const [facets, setFacets] = useState(EMPTY_FACETS)
  const [facetsError, setFacetsError] = useState('')
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [minPriceDraft, setMinPriceDraft] = useState(minPrice)
  const [maxPriceDraft, setMaxPriceDraft] = useState(maxPrice)

  useEffect(() => {
    setMinPriceDraft(minPrice)
    setMaxPriceDraft(maxPrice)
  }, [minPrice, maxPrice])

  useEffect(() => {
    let active = true
    axios.get(`${backendUrl}/api/product/facets`)
      .then(response => {
        if (!response.data.success) throw new Error(response.data.message || 'Unable to load catalogue filters.')
        if (active) {
          setFacets(response.data.facets || EMPTY_FACETS)
          setFacetsError('')
        }
      })
      .catch(error => {
        if (active) setFacetsError(error.response?.data?.message || error.message || 'Unable to load catalogue filters.')
      })
    return () => { active = false }
  }, [backendUrl])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      if (mode === 'campaign' && !campaign) {
        setItems([])
        setPagination({ page: 1, pages: 0, total: 0 })
        setError('This collection could not be found.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      try {
        const response = await axios.get(`${backendUrl}/api/product/list`, {
          params: {
            page,
            limit: PAGE_SIZE,
            sort,
            productType: productType || undefined,
            category: category || undefined,
            collection: campaign?.collectionTag,
            search: search || undefined,
            fabric: fabric || undefined,
            colour: colour || undefined,
            occasion: occasion || undefined,
            minPrice: minPrice || undefined,
            maxPrice: maxPrice || undefined,
            availableOnly: availableOnly ? 'true' : undefined
          }
        })
        if (!response.data.success) throw new Error(response.data.message || 'Unable to load this collection.')
        if (active) {
          setItems(response.data.products || [])
          setPagination(response.data.pagination || { page: 1, pages: 0, total: 0 })
        }
      } catch (requestError) {
        if (active) {
          setError(requestError.response?.data?.message || requestError.message || 'Unable to load this collection.')
          setItems([])
        }
      } finally {
        if (active) setLoading(false)
      }
    }, 180)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    backendUrl, campaign, category, productType, page, search, sort, mode, fabric, colour, occasion,
    minPrice, maxPrice, availableOnly
  ])

  const changeQuery = (key, value) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setSearchParams(next)
  }

  const applyPriceFilter = event => {
    event.preventDefault()
    const next = new URLSearchParams(searchParams)
    if (minPriceDraft) next.set('minPrice', minPriceDraft)
    else next.delete('minPrice')
    if (maxPriceDraft) next.set('maxPrice', maxPriceDraft)
    else next.delete('maxPrice')
    next.delete('page')
    setSearchParams(next)
  }

  const clearFilters = () => {
    if (mode === 'campaign') {
      navigate(`/collections/${campaignSlug}`)
      return
    }
    if (mode === 'category') {
      navigate(`/category/${routeCategory}`)
      return
    }
    setSearchParams({})
  }

  const title = campaign?.name || (mode === 'category'
    ? categoryForSlug(routeCategory)?.label || category
    : productType ? PRODUCT_TYPES[Object.keys(PRODUCT_TYPES).find(key => PRODUCT_TYPES[key].value === productType)]?.label || 'Shop'
      : 'Shop sarees & ethnic wear')
  const removeParams = keys => {
    const next = new URLSearchParams(searchParams)
    keys.forEach(key => next.delete(key))
    next.delete('page')
    setSearchParams(next)
  }
  const activeFilters = [
    mode !== 'category' && productType && { key: 'productType', label: productType.replace(/-/g, ' '), clear: () => removeParams(['productType']) },
    mode !== 'category' && category && { key: 'category', label: category, clear: () => removeParams(['category']) },
    search && { key: 'search', label: `Search: ${search}`, clear: () => removeParams(['search']) },
    fabric && { key: 'fabric', label: fabric, clear: () => removeParams(['fabric']) },
    colour && { key: 'colour', label: colour, clear: () => removeParams(['colour']) },
    occasion && { key: 'occasion', label: occasion, clear: () => removeParams(['occasion']) },
    (minPrice || maxPrice) && {
      key: 'price',
      label: `₹${minPrice || '0'} – ${maxPrice ? `₹${maxPrice}` : 'any'}`,
      clear: () => removeParams(['minPrice', 'maxPrice'])
    },
    availableOnly && { key: 'availableOnly', label: 'In stock', clear: () => removeParams(['availableOnly']) }
  ].filter(Boolean)
  const headingDescription = campaign?.description || (
    mode === 'category'
      ? `Explore available ${title.toLowerCase()} from PSH.`
      : 'Explore sarees and ethnic wear from the PSH catalogue.'
  )

  return (
    <main className='collection-page'>
      {campaign ? (
        <PromotionBanner
          eyebrow={campaign.eyebrow}
          title={campaign.name}
          description={campaign.description}
          image={items[0]?.images?.find(image => image.role === 'primary')?.url}
          to='/collection'
          actionLabel='Browse all products'
        />
      ) : (
        <header className='collection-heading'>
          <p className='eyebrow'>PSH Sarees & Ethnic Wear</p>
          <h1>{title}</h1>
          <p>{headingDescription}</p>
        </header>
      )}

      <nav aria-label='Breadcrumb' className='mt-2 flex flex-wrap items-center text-xs text-stone-600'>
        <Link to='/' className='crumb-link underline underline-offset-2'>Home</Link>
        <span aria-hidden='true'>&nbsp;/&nbsp;</span>
        {title === 'Shop sarees & ethnic wear'
          ? <span aria-current='page'>Shop</span>
          : <><Link to='/collection' className='crumb-link underline underline-offset-2'>Shop</Link>
            <span aria-hidden='true'>&nbsp;/&nbsp;</span><span aria-current='page'>{title}</span></>}
      </nav>

      {activeFilters.length > 0 && (
        <ul className='mt-4 flex flex-wrap gap-2' aria-label='Active filters'>
          {activeFilters.map(filter => (
            <li key={filter.key}>
              <button type='button' onClick={() => filter.clear()}
                className='min-h-9 border border-stone-300 bg-white px-3 text-xs text-stone-800'
                aria-label={`Remove filter ${filter.label}`}>
                {filter.label} <span aria-hidden='true'>×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className='collection-toolbar mt-6 flex items-center justify-between gap-3'>
        <button type='button' onClick={() => setMobileFiltersOpen(open => !open)}
          className='filter-toggle min-h-11 px-4 text-sm font-medium sm:hidden' aria-expanded={mobileFiltersOpen}>
          {mobileFiltersOpen ? 'Hide filters' : 'Filter products'}
        </button>
        <p className='text-sm text-stone-600' aria-live='polite'>
          {loading ? 'Loading products…' : `${pagination.total} ${pagination.total === 1 ? 'product' : 'products'}`}
        </p>
        <label className='ml-auto flex items-center gap-2 text-sm text-stone-700'>
          <span className='hidden sm:inline'>Sort by</span>
          <select value={sort} onChange={event => changeQuery('sort', event.target.value)}
            className='sort-select min-h-11 bg-white px-2' aria-label='Sort products'>
            <option value='newest'>Newest</option>
            <option value='price-asc'>Price: low to high</option>
            <option value='price-desc'>Price: high to low</option>
          </select>
        </label>
      </div>

      {facetsError && (
        <p role='status' className='mt-3 border border-amber-300 bg-amber-50 p-3 text-xs text-stone-700'>
          Some catalogue filters are unavailable: {facetsError}
        </p>
      )}

      <div className='collection-layout mt-4 grid gap-5 sm:grid-cols-[15rem_minmax(0,1fr)]'>
        <aside className={`${mobileFiltersOpen ? 'block' : 'hidden'} collection-filters p-4 sm:block`}>
          <div className='flex items-center justify-between gap-3'>
            <h2 className='font-semibold text-rose-950'>Refine your search</h2>
            <button type='button' onClick={clearFilters} className='text-xs underline underline-offset-2'>Clear</button>
          </div>

          <div className='mt-4 grid gap-3'>
            <CatalogueSelect label='Product type' value={productType} options={facets.productTypes
              .filter(type => PRODUCT_TYPES[Object.keys(PRODUCT_TYPES).find(key => PRODUCT_TYPES[key].value === type)])
              .map(type => ({ value: type, label: PRODUCT_TYPES[Object.keys(PRODUCT_TYPES).find(key => PRODUCT_TYPES[key].value === type)].label }))}
              onChange={value => changeQuery('productType', value)} allLabel='All product types' />
            <CatalogueSelect label='Category' value={category} options={facets.categories.map(value => ({ value, label: value }))}
              onChange={value => changeQuery('category', value)} allLabel='All categories' />
            <CatalogueSelect label='Fabric' value={fabric} options={facets.fabrics.map(value => ({ value, label: value }))}
              onChange={value => changeQuery('fabric', value)} allLabel='All fabrics' />
            <CatalogueSelect label='Colour' value={colour} options={facets.colours.map(value => ({ value, label: value }))}
              onChange={value => changeQuery('colour', value)} allLabel='All colours' />
            <CatalogueSelect label='Occasion' value={occasion} options={facets.occasions.map(value => ({ value, label: value }))}
              onChange={value => changeQuery('occasion', value)} allLabel='All occasions' />
          </div>

          <form className='catalogue-price-filter mt-5' onSubmit={applyPriceFilter}>
            <legend>Price range (₹)</legend>
            <div className='mt-2 grid grid-cols-2 gap-2'>
              <label>
                <span className='sr-only'>Minimum price</span>
                <input type='number' min='0' step='0.01' inputMode='decimal' placeholder='Min'
                  value={minPriceDraft} onChange={event => setMinPriceDraft(event.target.value)} />
              </label>
              <label>
                <span className='sr-only'>Maximum price</span>
                <input type='number' min='0' step='0.01' inputMode='decimal' placeholder='Max'
                  value={maxPriceDraft} onChange={event => setMaxPriceDraft(event.target.value)} />
              </label>
            </div>
            <button type='submit' className='catalogue-apply-button mt-2 min-h-10 w-full'>Apply price</button>
          </form>

          <label className='catalogue-stock-filter mt-4'>
            <input type='checkbox' checked={availableOnly} onChange={event =>
              changeQuery('availableOnly', event.target.checked ? 'true' : '')} />
            <span>In-stock options only</span>
          </label>

          {mode === 'campaign' && (
            <div className='mt-6 border-t border-stone-200 pt-4'>
              <h2 className='font-semibold text-rose-950'>Festive collections</h2>
              <div className='mt-2 flex flex-wrap gap-2 sm:flex-col'>
                {campaigns.filter(item => item.slug !== campaignSlug).map(item => (
                  <Link key={item.slug} to={`/collections/${item.slug}`} className='py-1 text-sm text-rose-900 underline underline-offset-2'>
                    {item.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section aria-label={`${title} products`}>
          {error && <p role='alert' className='border border-red-200 bg-red-50 p-4 text-sm text-red-900'>{error}</p>}
          {!error && loading && <p className='py-12 text-center text-sm text-stone-600'>Loading products…</p>}
          {!error && !loading && items.length === 0 && (
            <div className='catalogue-empty text-center'>
              <p className='eyebrow'>A thoughtful edit</p>
              <h2>No products found</h2>
              <p>{campaign
                ? `There are no published products tagged for ${campaign.name} yet.`
                : 'No products match these filters. Try changing your selections.'}</p>
              <button type='button' onClick={clearFilters} className='button button--wine mt-5'>Clear filters</button>
            </div>
          )}
          {!error && items.length > 0 && (
            <div className='product-grid product-grid--collection'>
              {items.map(product => <ProductItem key={product._id} product={product} />)}
            </div>
          )}

          {pagination.pages > 1 && (
            <nav aria-label='Product pages' className='mt-8 flex items-center justify-center gap-3'>
              <button type='button' disabled={page <= 1 || loading}
                onClick={() => changeQuery('page', String(page - 1))}
                className='pagination-button min-h-11 px-4 text-sm disabled:opacity-40'>Previous</button>
              <span className='text-sm text-stone-700'>Page {page} of {pagination.pages}</span>
              <button type='button' disabled={page >= pagination.pages || loading}
                onClick={() => changeQuery('page', String(page + 1))}
                className='pagination-button min-h-11 px-4 text-sm disabled:opacity-40'>Next</button>
            </nav>
          )}
        </section>
      </div>
    </main>
  )
}

Collection.propTypes = {
  mode: PropTypes.oneOf(['all', 'campaign', 'category'])
}

export default Collection
