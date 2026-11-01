// The seller picks at most one highlight; the form stores it as the two existing/new boolean fields.
export const HIGHLIGHT_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'fast-selling', label: 'Fast Selling' },
  { value: 'best-seller', label: 'Best Seller' }
]

export const highlightFromProduct = product => {
  if (product?.bestseller === true) return 'best-seller'
  if (product?.fastSelling === true) return 'fast-selling'
  return 'none'
}

export const applyHighlight = (product, value) => ({
  ...product,
  bestseller: value === 'best-seller',
  fastSelling: value === 'fast-selling'
})
