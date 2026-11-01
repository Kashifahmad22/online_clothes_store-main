export const availableQuantity = variant =>
  Math.max(0, (variant?.stockOnHand || 0) - (variant?.reserved || 0))

export const isVariantAvailable = variant =>
  variant?.active !== false && availableQuantity(variant) > 0

// Units the shopper can still add: stock minus what this variant already has in the cart.
export const remainingQuantity = (variant, inCart = 0) =>
  isVariantAvailable(variant) ? Math.max(0, availableQuantity(variant) - Math.max(0, inCart || 0)) : 0

// Validates a typed quantity without altering it: only whole numbers from 1 to the remaining stock are accepted.
export const validatePurchaseQuantity = (raw, variant, inCart = 0) => {
  const text = String(raw ?? '').trim()
  const remaining = remainingQuantity(variant, inCart)
  if (remaining < 1) return { valid: false, quantity: 0, error: 'The maximum available quantity is already in your cart.' }
  if (text === '') return { valid: false, quantity: 0, error: 'Enter a quantity.' }
  if (!/^\d+$/.test(text)) return { valid: false, quantity: 0, error: 'Enter a whole number of 1 or more.' }
  const quantity = Number(text)
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return { valid: false, quantity: 0, error: 'Enter a whole number of 1 or more.' }
  }
  if (quantity > remaining) {
    return {
      valid: false,
      quantity: 0,
      error: inCart > 0
        ? 'That is more than is available, including what is already in your cart.'
        : 'That quantity is more than we can supply right now.'
    }
  }
  return { valid: true, quantity, error: '' }
}

// Customer-facing merchandising badges. The admin-chosen badge and the backend-calculated low-stock flag
// are the only inputs; nothing is inferred here, and unavailable products never carry a badge.
export const MERCHANDISING_BADGE_LABELS = {
  'best-seller': 'Best Seller',
  'fast-selling': 'Fast Selling',
  'low-stock': 'Low Stock'
}

export const getMerchandisingBadges = product => {
  if (!product || getAvailableStock(product) < 1) return []
  const badges = []
  if (product.bestseller === true) badges.push('best-seller')
  else if (product.fastSelling === true) badges.push('fast-selling')
  if (product.lowStock === true) badges.push('low-stock')
  return badges
}

export const getProductImage = product => {
  const images = [...(product?.images || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
  return images.find(image => image.role === 'primary') || images[0] || null
}

const toPaise = value => (Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null)

// Card price semantics. Only active variants with a valid price are compared (public prices are rupees; they are
// compared in whole paise to avoid float noise). With no usable variant the product's own price is used.
// `from` is true only when active variants genuinely differ, and the discount is then withheld: the single MRP
// is a product-level value and cannot honestly describe a range of prices.
export const getPriceSummary = product => {
  const prices = (product?.variants || [])
    .filter(variant => variant && variant.active !== false)
    .map(variant => toPaise(variant.price))
    .filter(paise => paise !== null)
  const lowest = prices.length ? Math.min(...prices) : toPaise(product?.price)
  if (lowest === null) return { price: null, from: false, mrp: null }
  const from = prices.length > 0 && Math.max(...prices) > lowest
  const price = lowest / 100
  const mrp = !from && Number.isFinite(product?.mrp) && product.mrp > price ? product.mrp : null
  return { price, from, mrp }
}

const PLACEHOLDER_VALUE = /^(?:n\/?a|na|none|null|undefined|nil|tbd|not specified|unknown|-+|\.+)$/i

// Fabric and colour come only from the admin-entered `details` of the public product; nothing is inferred.
export const getCardAttributes = product => ['fabric', 'colour'].flatMap(key => {
  const value = product?.details?.[key]
  if (typeof value !== 'string') return []
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean && !PLACEHOLDER_VALUE.test(clean) ? [clean.slice(0, 40)] : []
})

// Low-stock urgency uses the backend-derived flag only, and never for an unavailable product.
export const showLowStockNote = product => product?.lowStock === true && getAvailableStock(product) > 0

export const getAvailableStock = product => (product?.variants || [])
  .filter(isVariantAvailable)
  .reduce((total, variant) => total + availableQuantity(variant), 0)
