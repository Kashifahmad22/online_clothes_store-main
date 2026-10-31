import { useContext, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import { ShopContext } from '../context/ShopContext'
import ProductGallery from '../components/ProductGallery'
import ProductPrice from '../components/ProductPrice'
import RelatedProducts from '../components/RelatedProducts'
import { availableQuantity, isVariantAvailable } from '../utils/productDisplay'

const detailLabels = {
  fabric: 'Fabric',
  composition: 'Composition',
  variety: 'Fabric variety',
  weavingTechnique: 'Weaving technique',
  texture: 'Texture',
  fabricFinish: 'Fabric finish',
  weightCategory: 'Weight',
  opacity: 'Transparency',
  drape: 'Drape',
  fabricFeel: 'Fabric feel',
  seasonalSuitability: 'Seasonal suitability',
  origin: 'Origin',
  colour: 'Colour',
  pattern: 'Pattern',
  border: 'Border',
  pallu: 'Pallu',
  zariType: 'Zari type',
  decorativeWork: 'Decorative work',
  printTechnique: 'Print technique',
  designStyle: 'Design style',
  occasion: 'Occasion',
  sareeLength: 'Saree length',
  careInstructions: 'Care instructions',
  whatsIncluded: 'Included in the package',
  blousePieceType: 'Blouse-piece type',
  blouseFabric: 'Blouse fabric',
  blouseColour: 'Blouse colour',
  blouseLength: 'Blouse length',
  blousePattern: 'Blouse pattern',
  blouseStitching: 'Blouse stitching'
}

const Product = () => {
  const { productId } = useParams()
  const { getProductById, addToCart, siteSettings } = useContext(ShopContext)
  const [product, setProduct] = useState(null)
  const [variantId, setVariantId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingToCart, setAddingToCart] = useState(false)
  const [footerVisible, setFooterVisible] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    getProductById(productId)
      .then(data => {
        if (!active) return
        setProduct(data)
        const variants = data.variants || []
        const firstAvailable = variants.find(isVariantAvailable)
        setVariantId((firstAvailable || variants.find(variant => variant.active !== false))?._id || '')
      })
      .catch(requestError => {
        if (!active) return
        const message = requestError.response?.status === 404
          ? 'This product is no longer available.'
          : requestError.response?.data?.message || requestError.message || 'Unable to load this product.'
        setError(message)
        setProduct(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [productId, getProductById])

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    setFooterVisible(false)
    const footer = document.querySelector('.site-footer')
    if (!footer) return
    const observer = new IntersectionObserver(([entry]) => {
      setFooterVisible(entry.isIntersecting)
    }, { rootMargin: '0px 0px 80px 0px' })
    observer.observe(footer)
    return () => observer.disconnect()
  }, [productId])

  const selectedVariant = product?.variants?.find(variant => variant._id === variantId)
  const price = selectedVariant?.price ?? product?.price
  const mrp = Number.isFinite(product?.mrp) && product.mrp > price ? product.mrp : null
  const isAvailable = isVariantAvailable(selectedVariant)
  const productImages = useMemo(() => [...(product?.images || [])]
    .sort((a, b) => {
      if (a.role === 'primary') return -1
      if (b.role === 'primary') return 1
      return (a.order || 0) - (b.order || 0)
    }), [product])
  const specifications = Object.entries(product?.details || {}).flatMap(([key, value]) => {
    if (key === 'specifications' || key === 'blousePieceIncluded' ||
      key.startsWith('blouse') && !product?.details?.blousePieceIncluded) return []
    if (typeof value !== 'string' || !value.trim()) return []
    return [[detailLabels[key] || key.replace(/([A-Z])/g, ' $1'), value]]
  })

  useEffect(() => {
    if (!product) return
    document.title = product.seo?.title || `${product.name} | ${siteSettings.brand.publicName}`
    const description = product.seo?.description || product.description
    const metaDescription = document.querySelector('meta[name="description"]')
    if (metaDescription && description) metaDescription.setAttribute('content', description.slice(0, 320))
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title)
    document.querySelector('meta[property="og:description"]')
      ?.setAttribute('content', (description || '').slice(0, 320))
    document.querySelector('meta[property="og:type"]')?.setAttribute('content', 'product')
    const primaryImage = productImages.find(image => image.role === 'primary') || productImages[0]
    if (primaryImage?.url) {
      document.querySelector('meta[property="og:image"]')
        ?.setAttribute('content', primaryImage.url)
    }
  }, [product, productImages, siteSettings.brand.publicName])

  if (loading) return <p className='py-20 text-center text-sm text-stone-600'>Loading product details…</p>
  if (error || !product) {
    return (
      <div className='catalogue-empty my-10 text-center'>
        <p role='alert' className='text-stone-700'>{error || 'Product not found.'}</p>
        <Link to='/collection' className='button button--wine mt-5'>Browse all products</Link>
      </div>
    )
  }

  const addSelectedToCart = async () => {
    if (addingToCart) return
    if (!selectedVariant || !isVariantAvailable(selectedVariant)) {
      toast.error('This option is currently unavailable.')
      return
    }
    setAddingToCart(true)
    try {
      await addToCart(product._id, selectedVariant._id)
    } finally {
      setAddingToCart(false)
    }
  }

  return (
    <main className='product-page'>
      <div className='product-layout'>
        <ProductGallery key={product._id} images={productImages} productName={product.name} />

        <section className='product-info pb-20 md:pb-0'>
          <Link to='/collection' className='product-breadcrumb'>Shop <span aria-hidden='true'>/</span> {product.category}</Link>
          <p className='product-kicker'>
            {product.productType === 'saree' ? 'Saree' : product.category}
          </p>
          <h1 className='product-title'>{product.name}</h1>
          {selectedVariant?.sku && <p className='mt-3 text-xs tracking-wide text-stone-500'>SKU: {selectedVariant.sku}</p>}
          <div className='mt-5 border-y border-[#e7dfd3] py-4'>
            <ProductPrice price={price} mrp={mrp} />
          </div>

          {product.description && <p className='product-description whitespace-pre-line'>{product.description}</p>}

          {product.variants?.length > 0 && (
            <fieldset className='variant-options mt-6'>
              <legend className='text-sm font-semibold text-stone-900'>
                {Object.keys(product.variants[0].options || {}).join(' / ') || 'Product option'}
              </legend>
              <div className='mt-3 flex flex-wrap gap-2'>
                {product.variants.filter(variant => variant.active !== false).map(variant => {
                  const optionLabel = Object.values(variant.options || {}).join(' / ') || variant.sku
                  const available = isVariantAvailable(variant)
                  return (
                    <button
                      type='button'
                      key={variant._id}
                      disabled={!available}
                      onClick={() => setVariantId(variant._id)}
                      aria-pressed={variant._id === variantId}
                      className={`variant-option min-h-11 border px-3 py-2 text-sm ${variant._id === variantId ? 'variant-option--selected' : ''} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {optionLabel}{!available ? ' · Out of stock' : ''}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}

          <p className={`product-availability mt-4 text-sm font-medium ${isAvailable ? 'product-availability--available' : 'text-stone-600'}`}>
            {isAvailable ? `In stock · ${availableQuantity(selectedVariant)} available` : 'Currently out of stock'}
          </p>

          <button
            type='button'
            disabled={!isAvailable || addingToCart}
            onClick={addSelectedToCart}
            className='button button--wine mt-5 hidden min-h-12 w-full uppercase tracking-wide disabled:cursor-not-allowed disabled:bg-stone-400 sm:block'
          >
            {addingToCart ? 'Adding…' : isAvailable ? 'Add to cart' : 'Unavailable'}
          </button>

          {typeof product.details?.blousePieceIncluded === 'boolean' && (
            <p className='blouse-note mt-5 p-4 text-sm text-stone-800'>
              <strong>Blouse piece:</strong> {product.details.blousePieceIncluded ? 'Included' : 'Not included'}
            </p>
          )}

          {(specifications.length > 0 || product.details?.specifications?.length > 0) && (
            <details className='product-specifications mt-7' open>
              <summary>Saree details <span aria-hidden='true'>＋</span></summary>
              <dl className='mt-3 text-sm'>
                {specifications.map(([label, value]) => (
                  <div key={label} className='grid grid-cols-[minmax(7rem,0.8fr)_1.2fr] gap-3 py-2.5'>
                    <dt className='font-medium text-stone-700'>{label}</dt>
                    <dd className='whitespace-pre-line text-stone-600'>{value}</dd>
                  </div>
                ))}
                {(product.details?.specifications || []).filter(spec => spec.label?.trim() && spec.value?.trim()).map(spec => (
                  <div key={`${spec.label}-${spec.value}`} className='grid grid-cols-[minmax(7rem,0.8fr)_1.2fr] gap-3 py-2.5'>
                    <dt className='font-medium text-stone-700'>{spec.label}</dt>
                    <dd className='whitespace-pre-line text-stone-600'>{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </section>
      </div>

      {!footerVisible && (
        <div className='product-sticky-cart fixed inset-x-0 bottom-0 z-30 p-3 sm:hidden'>
          <div className='mx-auto flex max-w-7xl items-center justify-between gap-3'>
            <ProductPrice price={price} mrp={mrp} compact />
            <button type='button' disabled={!isAvailable || addingToCart} onClick={addSelectedToCart}
              className='min-h-11 flex-1 bg-rose-950 px-4 text-sm font-semibold uppercase text-white disabled:bg-stone-400'>
              {addingToCart ? 'Adding…' : isAvailable ? 'Add to cart' : 'Out of stock'}
            </button>
          </div>
        </div>
      )}

      <RelatedProducts product={product} />
    </main>
  )
}

export default Product
