export const MAX_STOCK_ADJUSTMENT = 100000

export const OPERATIONS = [
  { value: 'receive', label: 'Receive stock (add)' },
  { value: 'correction', label: 'Stock correction (add or remove)' }
]

export const availableStock = variant => {
  const onHand = Number.isSafeInteger(variant?.stockOnHand) ? variant.stockOnHand : 0
  const reserved = Number.isSafeInteger(variant?.reserved) ? variant.reserved : 0
  return Math.max(0, onHand - reserved)
}

// Returns { error } or { body, negative }. The quantity is always a change, never a replacement total.
export const buildAdjustment = ({ operation, quantity, reason }) => {
  const text = String(quantity ?? '').trim()
  if (!/^[+-]?\d+$/.test(text)) return { error: 'Enter a whole number quantity.' }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value === 0) return { error: 'Quantity cannot be zero.' }
  if (Math.abs(value) > MAX_STOCK_ADJUSTMENT) {
    return { error: `A single adjustment cannot exceed ${MAX_STOCK_ADJUSTMENT} pieces.` }
  }
  if (operation === 'receive') {
    if (value < 0) return { error: 'Received stock must be positive. Use Stock correction to remove stock.' }
    return { body: { operation, quantity: value }, negative: false }
  }
  if (operation !== 'correction') return { error: 'Choose an adjustment type.' }
  const trimmed = String(reason || '').trim()
  if (trimmed.length < 3) return { error: 'Enter a reason for the correction (at least 3 characters).' }
  if (trimmed.length > 200) return { error: 'Reason must be 200 characters or fewer.' }
  return { body: { operation, quantity: value, reason: trimmed }, negative: value < 0 }
}

export const negativeConfirmMessage = (sku, quantity) =>
  `Remove ${Math.abs(quantity)} piece(s) from stock on hand for ${sku}? This reduces sellable inventory and cannot be undone automatically.`
