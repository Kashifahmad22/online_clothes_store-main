import { categorySlug } from './campaigns.js'

export const productCategories = [
  { type: 'saree', slug: 'sarees', label: 'Sarees' },
  { type: 'suit', slug: 'suits', label: 'Suits' },
  { type: 'suit-set', slug: 'suit-sets', label: 'Suit sets' },
  { type: 'dress', slug: 'dresses', label: 'Dresses' },
  { type: 'suit-piece', slug: 'suit-pieces', label: 'Suit pieces' },
  { type: 'lehenga', slug: 'lehengas', label: 'Lehengas' },
  { type: 'other', slug: 'other', label: 'Other ethnic wear' }
]

export const categoryForType = type => productCategories.find(category => category.type === type) || {
  type,
  slug: type.replace(/_/g, '-').replace(/-+$/, '') + (type.endsWith('s') ? '' : 's'),
  label: type.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

export const categoryForSlug = slug => productCategories.find(category => category.slug === slug)

export const availableProductCategories = products => {
  const categories = new Map()
  for (const product of products) {
    const typeCategory = categoryForType(product.productType)
    if (product.productType !== 'other' || !product.category) {
      categories.set(typeCategory.slug, { ...typeCategory, product })
    }

    const label = typeof product.category === 'string' ? product.category.trim() : ''
    const slug = label ? categorySlug(label) : ''
    if (!slug) continue
    const category = categoryForSlug(slug)
    if (category) {
      if (!categories.has(category.slug)) categories.set(category.slug, { ...category, product })
    } else if (!categories.has(slug)) {
      categories.set(slug, { type: `category:${slug}`, slug, label, product })
    }
  }
  return [...categories.values()]
}

// Public assortment shown in navigation and on the homepage. Sarees is the live range; the others
// become shoppable automatically once a product exists for them, and stay "Coming soon" until then.
export const storefrontCategories = [
  { slug: 'sarees', label: 'Sarees', alwaysAvailable: true },
  { slug: 'suit-pieces', label: 'Suit Pieces' },
  { slug: 'lehengas', label: 'Lehengas' },
  { slug: 'kurtis', label: 'Kurtis' }
]

export const storefrontNavigation = products => {
  const live = availableProductCategories(products)
  const liveBySlug = new Map(live.map(category => [category.slug, category]))
  const featuredSlugs = new Set(storefrontCategories.map(category => category.slug))
  const featured = storefrontCategories.map(({ slug, label, alwaysAvailable }) => {
    const match = liveBySlug.get(slug)
    if (match) return { ...match, label, status: 'available' }
    return alwaysAvailable
      ? { slug, label, type: 'saree', product: null, status: 'available' }
      : { slug, label, product: null, status: 'upcoming' }
  })
  const others = live.filter(category => !featuredSlugs.has(category.slug))
    .map(category => ({ ...category, status: 'available' }))
  return [...featured, ...others]
}

export const isUpcomingStorefrontCategory = (slug, products) =>
  storefrontNavigation(products).some(category => category.slug === slug && category.status === 'upcoming')
