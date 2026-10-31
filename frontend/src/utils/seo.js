import { campaignBySlug, categoryFromSlug } from '../config/campaigns.js'
import { categoryForSlug } from '../config/productCategories.js'
import { policyByPath } from '../config/policies.js'
import { socialImageUrl } from './images.js'
import { availableQuantity } from './productDisplay.js'

const stripText = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const truncate = (value, max) => value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
const text = value => typeof value === 'string' && value.trim() ? value.trim() : ''
const formatPrice = price => Number(price).toFixed(2)

// Only absolute https image URLs are placed in metadata or structured data.
const publicImageUrl = value => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : ''
  } catch {
    return ''
  }
}

const publicImages = images => {
  const sorted = (images || [])
    .map(image => ({ ...image, url: publicImageUrl(image?.url) }))
    .filter(image => image.url)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
  const primary = sorted.find(image => image.role === 'primary')
  return primary ? [primary, ...sorted.filter(image => image !== primary)] : sorted
}

export const normaliseSiteUrl = value => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' ? parsed.origin : ''
  } catch {
    return ''
  }
}

export const productPath = product => `/product/${encodeURIComponent(product.slug || product._id)}`

const STATIC_TITLES = (brandName) => ({
  '/': brandName,
  '/collection': `Shop Sarees & Ethnic Wear | ${brandName}`,
  '/about': `About | ${brandName}`,
  '/contact': `Contact | ${brandName}`,
  '/cart': `Shopping Bag | ${brandName}`,
  '/place-order': `Cash on Delivery Checkout | ${brandName}`,
  '/orders': `Your Orders | ${brandName}`,
  '/login': `Sign in | ${brandName}`,
  '/verify': `Online Payment Unavailable | ${brandName}`
})

// Title, description and canonical URL for every non-product route.
export const buildPageMeta = ({ pathname, brandName, description, siteUrl, image = '' }) => {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  let title = STATIC_TITLES(brandName)[path]
  let pageDescription = description

  if (path === '/collection') {
    pageDescription = `Browse sarees and ethnic wear from ${brandName}.`
  } else if (path === '/contact') {
    pageDescription = `Contact ${brandName} for help with an order or a product question.`
  } else if (policyByPath[path]) {
    title = `${policyByPath[path].label} | ${brandName}`
    pageDescription = policyByPath[path].description
  } else if (path.startsWith('/collections/')) {
    const slug = path.split('/').pop()
    const campaign = campaignBySlug(slug)
    title = campaign ? `${campaign.name} collection | ${brandName}` : `${categoryFromSlug(slug)} collection | ${brandName}`
    pageDescription = campaign?.description || `Browse the ${categoryFromSlug(slug)} collection from ${brandName}.`
  } else if (path.startsWith('/category/')) {
    const slug = path.split('/').pop()
    const label = categoryForSlug(slug)?.label || categoryFromSlug(slug)
    title = `${label} | ${brandName}`
    pageDescription = `Browse ${label.toLowerCase()} from ${brandName}.`
  }

  return {
    title: title || brandName,
    description: pageDescription,
    canonicalUrl: `${siteUrl}${path === '/' ? '/' : path}`,
    image,
    type: 'website'
  }
}

export const buildProductMeta = (product, { siteUrl, brandName }) => {
  const canonicalUrl = `${siteUrl}${productPath(product)}`
  const primary = publicImages(product.images)[0]
  return {
    title: text(product.seo?.title) || `${product.name} | ${brandName}`,
    description: text(product.seo?.description) || truncate(stripText(product.description), 200),
    canonicalUrl,
    image: primary ? socialImageUrl(primary.url) : '',
    imageAlt: primary ? (text(primary.altText) || product.name) : '',
    type: 'product'
  }
}

export const buildProductJsonLd = (product, { siteUrl, brandName }) => {
  const meta = buildProductMeta(product, { siteUrl, brandName })
  const images = publicImages(product.images)
  const offers = (product.variants || []).filter(variant => variant.active !== false).map(variant => ({
    sku: variant.sku,
    price: Number.isFinite(variant.price) ? variant.price : product.price,
    inStock: availableQuantity(variant) > 0
  }))
  const toOffer = offer => ({
    '@type': 'Offer',
    url: meta.canonicalUrl,
    priceCurrency: 'INR',
    price: formatPrice(offer.price),
    availability: `https://schema.org/${offer.inStock ? 'InStock' : 'OutOfStock'}`,
    ...(offers.length > 1 ? { sku: offer.sku } : {})
  })
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url: meta.canonicalUrl,
    ...(meta.description ? { description: meta.description } : {}),
    ...(images.length ? { image: images.map(item => item.url) } : {}),
    ...(brandName ? { brand: { '@type': 'Brand', name: brandName } } : {}),
    ...(text(product.category) ? { category: product.category.trim() } : {}),
    ...(text(product.details?.fabric) ? { material: product.details.fabric.trim() } : {}),
    ...(text(product.details?.colour) ? { color: product.details.colour.trim() } : {}),
    ...(offers.length === 1 ? { sku: offers[0].sku } : {})
  }
  if (offers.length) {
    data.offers = offers.length === 1 ? toOffer(offers[0]) : offers.map(toOffer)
  } else if (Number.isFinite(product.price)) {
    data.offers = {
      '@type': 'Offer', url: meta.canonicalUrl, priceCurrency: 'INR', price: formatPrice(product.price)
    }
  }
  return data
}

const upsert = (doc, selector, create, content) => {
  const existing = doc.head.querySelector(selector)
  if (!content) {
    existing?.remove()
    return
  }
  const element = existing || create()
  element.setAttribute(element.tagName === 'LINK' ? 'href' : 'content', content)
  if (!existing) doc.head.appendChild(element)
}

const metaFactory = (doc, attribute, key) => () => {
  const element = doc.createElement('meta')
  element.setAttribute(attribute, key)
  return element
}

// Updates the document head in place. Missing tags are created and empty values remove the tag,
// so stale values from a previous page never linger.
export const applyPageMeta = (doc, meta, siteName = '') => {
  doc.title = meta.title
  const tags = [
    ['name', 'description', meta.description],
    ['property', 'og:type', meta.type || 'website'],
    ['property', 'og:site_name', siteName],
    ['property', 'og:title', meta.title],
    ['property', 'og:description', meta.description],
    ['property', 'og:url', meta.canonicalUrl],
    ['property', 'og:image', meta.image],
    ['property', 'og:image:alt', meta.image ? meta.imageAlt || meta.title : ''],
    ['name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary'],
    ['name', 'twitter:title', meta.title],
    ['name', 'twitter:description', meta.description],
    ['name', 'twitter:image', meta.image],
    ['name', 'twitter:image:alt', meta.image ? meta.imageAlt || meta.title : '']
  ]
  for (const [attribute, key, content] of tags) {
    upsert(doc, `meta[${attribute}="${key}"]`, metaFactory(doc, attribute, key), content)
  }
  upsert(doc, 'link[rel="canonical"]', () => {
    const link = doc.createElement('link')
    link.setAttribute('rel', 'canonical')
    return link
  }, meta.canonicalUrl)
}

export const setJsonLd = (doc, id, data) => {
  const existing = doc.getElementById(id)
  if (!data) {
    existing?.remove()
    return
  }
  const script = existing || doc.createElement('script')
  if (!existing) {
    script.id = id
    script.type = 'application/ld+json'
    doc.head.appendChild(script)
  }
  script.textContent = JSON.stringify(data).replace(/</g, '\\u003c')
}
