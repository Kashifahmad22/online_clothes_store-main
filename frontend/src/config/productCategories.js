import {
  CANONICAL_CATEGORIES, categoryById, normalizeCategoryLabel, resolveCategorySlug, resolveProductCategory
} from './canonicalCategories.js'
import { categoryFromSlug } from './campaigns.js'

// Legacy product-type table. It only labels the "Product type" filter and old type-derived URLs;
// top-level navigation comes from the canonical categories.
export const productCategories = [
  { type: 'saree', slug: 'sarees', label: 'Sarees' },
  { type: 'suit', slug: 'suits', label: 'Suits' },
  { type: 'suit-set', slug: 'suit-sets', label: 'Suit sets' },
  { type: 'dress', slug: 'dresses', label: 'Dresses' },
  { type: 'suit-piece', slug: 'suit-pieces', label: 'Suit pieces' },
  { type: 'lehenga', slug: 'lehengas', label: 'Lehengas' },
  { type: 'kurti', slug: 'kurtis', label: 'Kurtis' },
  { type: 'other', slug: 'other', label: 'Other ethnic wear' }
]

export const categoryForSlug = slug => productCategories.find(category => category.slug === slug)

// The Category filter offers exactly the canonical categories, never raw free-text labels.
export const categoryFilterOptions = CANONICAL_CATEGORIES.map(({ id, label }) => ({ value: id, label }))

// Single place that turns the route/URL state into the product list request for the Collection page.
// Category pages and the ?category= filter both end in the same `canonicalCategory` parameter. A recognised
// legacy subcategory label (Silk Sarees, Cotton Sarees, Suit Pants) keeps its parent category and also
// yields `subCategory`, so the narrower legacy link stays narrow. A label with no canonical meaning is
// still sent as the old exact-match `category` filter and never mapped to a category.
export const collectionCategoryParams = ({ mode, routeCategory, categoryParam = '', productTypeParam = '' }) => {
  if (mode === 'category') {
    const resolved = resolveCategorySlug(routeCategory)
    if (resolved) {
      return {
        canonical: resolved.category,
        subCategory: resolved.subCategory,
        productType: resolved.productType || '',
        legacyLabel: resolved.legacyLabel || '',
        category: ''
      }
    }
    const productType = categoryForSlug(routeCategory)?.type || ''
    return {
      canonical: null,
      subCategory: null,
      productType,
      category: productType ? '' : categoryFromSlug(routeCategory || '')
    }
  }
  const raw = typeof categoryParam === 'string' ? categoryParam.trim() : ''
  const byId = raw ? categoryById(raw) : null
  const label = raw && !byId ? normalizeCategoryLabel(raw) : null
  const canonical = byId || label?.category || null
  return {
    canonical,
    subCategory: label?.subCategory || null,
    productType: productTypeParam,
    category: raw && !canonical ? raw : ''
  }
}

// Public assortment: always exactly the four canonical categories, never derived from product labels.
// Sarees is live; the others become shoppable once a product resolves to them and are "Coming soon"
// until then.
export const storefrontCategories = CANONICAL_CATEGORIES.map(({ slug, label, status }) => ({
  slug,
  label,
  ...(status === 'available' ? { alwaysAvailable: true } : {})
}))

// `catalogue` is the load state of the product list. Only a successfully loaded ('ready') catalogue can show a
// category as upcoming; while it is loading or failed, availability is unknown and must not read "Coming soon".
export const catalogueState = ({ productsLoading, productsError }) =>
  productsLoading ? 'loading' : productsError ? 'error' : 'ready'

export const storefrontNavigation = (products, catalogue = 'ready') => {
  const firstProduct = new Map()
  for (const product of products) {
    const slug = resolveProductCategory(product).category?.slug
    if (slug && !firstProduct.has(slug)) firstProduct.set(slug, product)
  }
  return storefrontCategories.map(({ slug, label, alwaysAvailable }) => {
    const product = firstProduct.get(slug) || null
    const status = alwaysAvailable || product ? 'available' : catalogue === 'ready' ? 'upcoming' : 'unknown'
    return { slug, label, product, status }
  })
}

export const isUpcomingStorefrontCategory = (slug, products) =>
  storefrontNavigation(products).some(category => category.slug === slug && category.status === 'upcoming')
