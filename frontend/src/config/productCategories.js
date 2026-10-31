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
