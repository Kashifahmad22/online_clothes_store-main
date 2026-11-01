// Frontend copy of backend/config/catalogueTaxonomy.js. The frontend is deployed on its own (Vercel root
// is /frontend), so it cannot import from ../backend. frontend/tests/canonicalCategoryDrift.test.js
// compares this file against the backend module and fails if they diverge.

export const CANONICAL_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'sarees', label: 'Sarees', slug: 'sarees', status: 'available' }),
  Object.freeze({ id: 'suit-pieces', label: 'Suit Pieces', slug: 'suit-pieces', status: 'coming-soon' }),
  Object.freeze({ id: 'lehengas', label: 'Lehengas', slug: 'lehengas', status: 'coming-soon' }),
  Object.freeze({ id: 'kurtis', label: 'Kurtis', slug: 'kurtis', status: 'coming-soon' })
])

const TYPE_TO_CATEGORY = Object.freeze({
  saree: 'sarees',
  'suit-piece': 'suit-pieces',
  suit: 'suit-pieces',
  'suit-set': 'suit-pieces',
  lehenga: 'lehengas',
  kurti: 'kurtis'
})

const LABEL_ALIASES = Object.freeze({
  saree: { categoryId: 'sarees', subCategory: null },
  sarees: { categoryId: 'sarees', subCategory: null },
  'silk sarees': { categoryId: 'sarees', subCategory: 'Silk Sarees' },
  'cotton sarees': { categoryId: 'sarees', subCategory: 'Cotton Sarees' },
  'suit piece': { categoryId: 'suit-pieces', subCategory: null },
  'suit pieces': { categoryId: 'suit-pieces', subCategory: null },
  'suit pants': { categoryId: 'suit-pieces', subCategory: 'Suit Pants' },
  lehenga: { categoryId: 'lehengas', subCategory: null },
  lehengas: { categoryId: 'lehengas', subCategory: null },
  kurti: { categoryId: 'kurtis', subCategory: null },
  kurtis: { categoryId: 'kurtis', subCategory: null }
})

// Old type-derived URLs that already map to a category. `dresses` and `other` have no canonical
// category (dress is unresolved, other is unclassified), so they keep their legacy behaviour.
// `productType` keeps the original narrow filter: these URLs never widen to the whole parent category.
const LEGACY_SLUGS = Object.freeze({
  suits: { categoryId: 'suit-pieces', productType: 'suit', label: 'Suits' },
  'suit-sets': { categoryId: 'suit-pieces', productType: 'suit-set', label: 'Suit sets' }
})

export const categoryById = id => CANONICAL_CATEGORIES.find(category => category.id === id) || null

// Recognised subcategories, derived from the alias table (mirrors SUBCATEGORIES in the backend taxonomy).
export const SUBCATEGORIES = Object.freeze(Object.values(LABEL_ALIASES)
  .filter(alias => alias.subCategory)
  .map(alias => Object.freeze({ label: alias.subCategory, categoryId: alias.categoryId })))

const labelKey = value => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '')

export const normalizeCategoryLabel = raw => {
  const key = labelKey(raw)
  const alias = key && Object.hasOwn(LABEL_ALIASES, key) ? LABEL_ALIASES[key] : null
  if (!alias) return { raw, mapped: false, category: null, subCategory: null }
  return { raw, mapped: true, category: categoryById(alias.categoryId), subCategory: alias.subCategory }
}

// A known productType always wins; the legacy label is only consulted for `other`. `dress` stays unresolved.
export const resolveProductCategory = (product = {}) => {
  const rawCategory = typeof product.category === 'string' ? product.category : ''
  const storedSubCategory = typeof product.subCategory === 'string' ? product.subCategory.trim() : ''
  const typeId = Object.hasOwn(TYPE_TO_CATEGORY, product.productType) ? TYPE_TO_CATEGORY[product.productType] : null
  const label = normalizeCategoryLabel(rawCategory)
  if (typeId) {
    const conflict = label.mapped && label.category.id !== typeId
    return {
      category: categoryById(typeId),
      source: 'productType',
      status: 'mapped',
      subCategory: storedSubCategory || (label.mapped && !conflict ? label.subCategory : null),
      rawCategory,
      conflict
    }
  }
  if (label.mapped && product.productType === 'other') {
    return {
      category: label.category,
      source: 'label',
      status: 'mapped',
      subCategory: storedSubCategory || label.subCategory,
      rawCategory,
      conflict: false
    }
  }
  return {
    category: null,
    source: null,
    status: product.productType === 'other' ? 'unclassified' : 'unresolved',
    subCategory: storedSubCategory || null,
    rawCategory,
    conflict: false
  }
}

// Resolves a /category/:slug URL to a canonical category, or null for slugs with no canonical meaning
// (those keep their existing free-text behaviour). `canonical` is true only for the canonical URL itself.
export const resolveCategorySlug = slug => {
  const key = typeof slug === 'string' ? slug.trim().toLowerCase() : ''
  if (!key) return null
  const direct = CANONICAL_CATEGORIES.find(category => category.slug === key)
  if (direct) return { category: direct, subCategory: null, canonical: true }
  const legacy = Object.hasOwn(LEGACY_SLUGS, key) ? LEGACY_SLUGS[key] : null
  if (legacy) {
    return {
      category: categoryById(legacy.categoryId),
      subCategory: null,
      productType: legacy.productType,
      legacyLabel: legacy.label,
      canonical: false
    }
  }
  const label = normalizeCategoryLabel(key.replace(/-+/g, ' '))
  return label.mapped ? { category: label.category, subCategory: label.subCategory, canonical: false } : null
}
