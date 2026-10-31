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
    return { valid: false, quantity: 0, error: `Only ${remaining} more available${inCart > 0 ? ' (you already have some in your cart)' : ''}.` }
  }
  return { valid: true, quantity, error: '' }
}

export const getProductImage = product => {
  const images = [...(product?.images || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
  return images.find(image => image.role === 'primary') || images[0] || null
}

export const getStartingPrice = product => {
  if (Number.isFinite(product?.startingPrice)) return product.startingPrice
  const availableVariants = (product?.variants || []).filter(isVariantAvailable)
  const prices = availableVariants.map(variant => variant.price)
    .filter(price => Number.isFinite(price) && price >= 0)
  if (prices.length) return Math.min(...prices)
  if (Number.isFinite(product?.price)) return product.price
  return null
}

export const getAvailableStock = product => (product?.variants || [])
  .filter(isVariantAvailable)
  .reduce((total, variant) => total + availableQuantity(variant), 0)
