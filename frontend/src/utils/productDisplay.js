export const availableQuantity = variant =>
  Math.max(0, (variant?.stockOnHand || 0) - (variant?.reserved || 0))

export const isVariantAvailable = variant =>
  variant?.active !== false && availableQuantity(variant) > 0

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
