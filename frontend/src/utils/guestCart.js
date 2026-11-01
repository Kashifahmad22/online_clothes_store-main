// Guest cart persistence. Only product ids, variant ids and quantities are stored: never prices, stock,
// names or customer data. Prices and stock always come from the live catalogue and are re-checked by the server.

export const GUEST_CART_STORAGE_KEY = 'psh_guest_cart_v1'
export const MAX_CART_QUANTITY = 99
export const MAX_CART_LINES = 50

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const isValidId = value => ID_PATTERN.test(value) && !RESERVED_KEYS.has(value)

// Returns a clean {productId: {variantId: quantity}} object, silently dropping anything malformed.
export const sanitiseCart = raw => {
  const cart = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cart
  let lines = 0
  for (const [productId, variants] of Object.entries(raw)) {
    if (!isValidId(productId) || !variants || typeof variants !== 'object' || Array.isArray(variants)) continue
    for (const [variantId, quantity] of Object.entries(variants)) {
      if (lines >= MAX_CART_LINES) return cart
      if (!isValidId(variantId) || !Number.isSafeInteger(quantity) || quantity < 1) continue
      if (!Object.hasOwn(cart, productId)) cart[productId] = {}
      cart[productId][variantId] = Math.min(quantity, MAX_CART_QUANTITY)
      lines += 1
    }
  }
  return cart
}

const defaultStorage = () => {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

export const loadGuestCart = (storage = defaultStorage()) => {
  if (!storage) return {}
  try {
    const stored = storage.getItem(GUEST_CART_STORAGE_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored)
    return parsed && parsed.version === 1 ? sanitiseCart(parsed.items) : {}
  } catch {
    return {}
  }
}

export const clearGuestCart = (storage = defaultStorage()) => {
  try {
    storage?.removeItem(GUEST_CART_STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory cart keeps working.
  }
}

export const saveGuestCart = (cart, storage = defaultStorage()) => {
  if (!storage) return
  const items = sanitiseCart(cart)
  if (Object.keys(items).length === 0) {
    clearGuestCart(storage)
    return
  }
  try {
    storage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify({ version: 1, items }))
  } catch {
    // See clearGuestCart.
  }
}

// Drops guest lines whose product or variant no longer exists in the freshly loaded catalogue.
// Quantities are left alone: the cart page already flags unavailable or over-stock lines.
export const reconcileGuestCart = (cart, products) => {
  const byId = new Map((Array.isArray(products) ? products : []).map(product => [product?._id, product]))
  const next = {}
  let removed = 0
  for (const [productId, variants] of Object.entries(cart || {})) {
    const product = byId.get(productId)
    for (const [variantId, quantity] of Object.entries(variants || {})) {
      if (product?.variants?.some(variant => variant._id === variantId)) {
        if (!Object.hasOwn(next, productId)) next[productId] = {}
        next[productId][variantId] = quantity
      } else {
        removed += 1
      }
    }
  }
  return { cart: next, removed }
}

// Combines a signed-in server cart with a guest cart. Quantities are added once per variant and never above
// `limitFor(productId, variantId)` (a known stock limit, or null when unknown) or MAX_CART_QUANTITY.
// `lines` lists exactly the variants whose server quantity must be updated.
export const mergeCarts = (serverCart, guestCart, limitFor = () => null) => {
  const merged = structuredClone(sanitiseCart(serverCart))
  const lines = []
  const dropped = []
  for (const [productId, variants] of Object.entries(sanitiseCart(guestCart))) {
    for (const [variantId, guestQuantity] of Object.entries(variants)) {
      const serverQuantity = merged[productId]?.[variantId] || 0
      const limit = limitFor(productId, variantId)
      const cap = Number.isSafeInteger(limit) ? Math.min(limit, MAX_CART_QUANTITY) : MAX_CART_QUANTITY
      const quantity = Math.min(serverQuantity + guestQuantity, cap)
      if (quantity <= serverQuantity) {
        dropped.push({ productId, variantId })
        continue
      }
      if (!merged[productId]) merged[productId] = {}
      merged[productId][variantId] = quantity
      lines.push({ productId, variantId, quantity, serverQuantity })
    }
  }
  return { merged, lines, dropped }
}
