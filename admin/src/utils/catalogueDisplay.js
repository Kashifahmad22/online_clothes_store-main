import { availableStock } from './stockAdjustment.js'

const wholeCount = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0)

// The server computes this with the same rule as the storefront. The fallback only covers a response
// that lacks it, and never invents a Low Stock state.
export const stockSummaryOf = product => {
  if (product?.stockSummary) {
    const { availableUnits, activeVariantCount, inactiveVariantCount, state } = product.stockSummary
    return {
      availableUnits: wholeCount(availableUnits),
      activeVariantCount: wholeCount(activeVariantCount),
      inactiveVariantCount: wholeCount(inactiveVariantCount),
      state
    }
  }
  const variants = product?.variants || []
  const active = variants.filter(variant => variant.active !== false)
  const units = active.reduce((total, variant) => total + availableStock(variant), 0)
  return {
    availableUnits: units,
    activeVariantCount: active.length,
    inactiveVariantCount: variants.length - active.length,
    state: units === 0 ? 'out-of-stock' : (product?.lowStock === true ? 'low-stock' : 'in-stock')
  }
}

export const merchandisingBadges = product => {
  const summary = stockSummaryOf(product)
  const badges = []
  if (product?.bestseller === true) badges.push({ key: 'bestseller', label: 'Best Seller', tone: 'gold' })
  if (product?.fastSelling === true) badges.push({ key: 'fastSelling', label: 'Fast Selling', tone: 'red' })
  if (summary.state === 'out-of-stock') badges.push({ key: 'out-of-stock', label: 'Out of Stock', tone: 'gray' })
  else if (summary.state === 'low-stock') badges.push({ key: 'low-stock', label: 'Low Stock', tone: 'amber' })
  return badges
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

export const stockLines = product => {
  const summary = stockSummaryOf(product)
  const lines = [`Available stock: ${summary.availableUnits}`]
  lines.push(summary.activeVariantCount === 0
    ? 'No active variants'
    : plural(summary.activeVariantCount, 'active variant'))
  if (summary.inactiveVariantCount > 0) lines.push(`${summary.inactiveVariantCount} inactive`)
  return lines
}

export const priceInfo = product => {
  const base = Number.isFinite(product?.pricePaise) ? product.pricePaise : 0
  // Same "from" price the storefront shows and the admin price sort orders by.
  const selling = Number.isFinite(product?.startingPricePaise) ? product.startingPricePaise : base
  const mrp = Number.isFinite(product?.mrpPaise) ? product.mrpPaise : null
  return {
    selling: (selling / 100).toFixed(2),
    mrp: mrp === null ? null : (mrp / 100).toFixed(2),
    // MRP is only shown as a crossed-out price when it is genuinely higher.
    mrpIsDiscount: mrp !== null && mrp > selling,
    isFrom: selling !== base
  }
}

export const productTypeLabel = value => ({
  saree: 'Saree', 'suit-piece': 'Suit piece', suit: 'Suit', 'suit-set': 'Suit set',
  dress: 'Dress', lehenga: 'Lehenga', other: 'Other ethnic wear'
}[value] || value || '—')
