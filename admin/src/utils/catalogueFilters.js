export const DEFAULT_SORT = 'updatedAt-desc'

export const STATUS_OPTIONS = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' }
]

export const TYPE_OPTIONS = [
  { value: 'saree', label: 'Saree' },
  { value: 'suit-piece', label: 'Suit piece / dress material' },
  { value: 'suit', label: 'Suit' },
  { value: 'suit-set', label: 'Suit set' },
  { value: 'dress', label: 'Dress' },
  { value: 'lehenga', label: 'Lehenga' },
  { value: 'other', label: 'Other ethnic wear' }
]

export const STOCK_OPTIONS = [
  { value: 'in-stock', label: 'In stock' },
  { value: 'low-stock', label: 'Low stock' },
  { value: 'out-of-stock', label: 'Out of stock' }
]

export const BADGE_OPTIONS = [
  { value: 'bestseller', label: 'Best Seller' },
  { value: 'fastSelling', label: 'Fast Selling' },
  { value: 'none', label: 'No badge' }
]

export const SORT_OPTIONS = [
  { value: 'updatedAt-desc', label: 'Recently updated' },
  { value: 'createdAt-desc', label: 'Recently added' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' }
]

export const MAX_SEARCH_LENGTH = 80
const MAX_CATEGORY_LENGTH = 100

export const emptyFilters = () => ({
  search: '', status: '', category: '', productType: '', stock: '', badge: '', sort: DEFAULT_SORT
})

const choice = (raw, options) => (options.some(option => option.value === raw) ? raw : '')
const text = (raw, max) => (raw ? raw.trim().slice(0, max) : '')

// Anything unrecognised in the URL is ignored, so the API is never sent a value it would reject.
export const parseFilters = params => ({
  search: text(params.get('search'), MAX_SEARCH_LENGTH),
  status: choice(params.get('status'), STATUS_OPTIONS),
  category: text(params.get('category'), MAX_CATEGORY_LENGTH),
  productType: choice(params.get('productType'), TYPE_OPTIONS),
  stock: choice(params.get('stock'), STOCK_OPTIONS),
  badge: choice(params.get('badge'), BADGE_OPTIONS),
  sort: choice(params.get('sort'), SORT_OPTIONS) || DEFAULT_SORT
})

const FILTER_KEYS = ['search', 'status', 'category', 'productType', 'stock', 'badge']

// URL form: defaults and empty values are omitted. Changing any filter drops the page, so it resets to 1.
export const filtersToParams = (filters, page = 1) => {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) if (filters[key]) params.set(key, filters[key])
  if (filters.sort && filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort)
  if (page > 1) params.set('page', String(page))
  return params
}

export const apiParams = (filters, page, limit) => {
  const params = { page, limit }
  for (const key of FILTER_KEYS) if (filters[key]) params[key] = filters[key]
  if (filters.sort !== DEFAULT_SORT) params.sort = filters.sort
  return params
}

const labelFor = (options, value) => options.find(option => option.value === value)?.label || value

export const activeFilterChips = filters => {
  const chips = []
  if (filters.search) chips.push({ key: 'search', label: `Search: “${filters.search}”` })
  if (filters.status) chips.push({ key: 'status', label: `Status: ${labelFor(STATUS_OPTIONS, filters.status)}` })
  if (filters.category) chips.push({ key: 'category', label: `Category: ${filters.category}` })
  if (filters.productType) chips.push({ key: 'productType', label: `Type: ${labelFor(TYPE_OPTIONS, filters.productType)}` })
  if (filters.stock) chips.push({ key: 'stock', label: `Stock: ${labelFor(STOCK_OPTIONS, filters.stock)}` })
  if (filters.badge) chips.push({ key: 'badge', label: `Badge: ${labelFor(BADGE_OPTIONS, filters.badge)}` })
  return chips
}

export const hasActiveFilters = filters => activeFilterChips(filters).length > 0

export const withFilter = (filters, key, value) => ({ ...filters, [key]: value })

// Clearing keeps the chosen sort order; it only removes search and filters.
export const clearedFilters = filters => ({ ...emptyFilters(), sort: filters.sort })

export const debounce = (fn, wait) => {
  let timer = null
  const run = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => { timer = null; fn(...args) }, wait)
  }
  run.cancel = () => { clearTimeout(timer); timer = null }
  run.pending = () => timer !== null
  return run
}
