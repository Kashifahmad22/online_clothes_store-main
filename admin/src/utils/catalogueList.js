export const PAGE_SIZE = 20

export const parsePageParam = raw => {
  if (raw === null || raw === undefined) return 1
  return /^[1-9]\d{0,6}$/.test(raw) ? Number(raw) : 1
}

// Returns the page to show instead when the requested one no longer exists, or null when it is valid.
export const correctedPage = ({ page, totalPages }) => {
  if (page > 1 && totalPages === 0) return 1
  if (totalPages > 0 && page > totalPages) return totalPages
  return null
}

export const pageSummary = ({ page, limit, totalProducts, totalPages }) => ({
  totalProducts,
  totalPages,
  page,
  from: totalProducts === 0 ? 0 : (page - 1) * limit + 1,
  to: Math.min(page * limit, totalProducts),
  hasPrevious: page > 1,
  hasNext: page < totalPages
})

// Only the most recently started request may apply its result.
export const createLatestGate = () => {
  let latest = 0
  return {
    next: () => ++latest,
    isCurrent: id => id === latest,
    invalidate: () => { latest += 1 }
  }
}

export const loadErrorMessage = error => {
  if (error?.response?.data?.message) return error.response.data.message
  if (error?.response) return 'The server could not load the catalogue.'
  if (error?.request) return 'Unable to reach the server. Check your connection and try again.'
  return error?.message || 'Unable to load the catalogue.'
}

// A load result only applies to the product it was requested for; any other id is still loading.
export const resolveLoadState = (info, currentKey) => (info.key === currentKey ? info.state : 'loading')
