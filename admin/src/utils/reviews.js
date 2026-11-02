export const REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'hidden', 'flagged']
export const STATUS_LABELS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', hidden: 'Hidden', flagged: 'Flagged' }
const REASON_REQUIRED = ['reject', 'hide', 'flag']

// Only offers actions that change the state; the backend enforces the same rules.
export const moderationActions = status => [
  { action: 'approve', label: 'Approve', needsReason: false },
  { action: 'reject', label: 'Reject', needsReason: true },
  { action: 'hide', label: 'Hide', needsReason: true },
  { action: 'flag', label: 'Flag', needsReason: true }
].filter(item => ({ approve: 'approved', reject: 'rejected', hide: 'hidden', flag: 'flagged' })[item.action] !== status)

export const validateModerationInput = (action, reason) => {
  const text = typeof reason === 'string' ? reason.trim() : ''
  if (REASON_REQUIRED.includes(action) && !text) return { error: 'Enter a reason for this action.' }
  if (text.length > 500) return { error: 'Reason must be 500 characters or fewer.' }
  return { reason: text }
}

export const buildListParams = ({ status, rating, source, q, page }) => {
  const params = { page: page || 1, limit: 20 }
  if (REVIEW_STATUSES.includes(status)) params.status = status
  if (/^[1-5]$/.test(String(rating))) params.rating = rating
  if (source === 'customer' || source === 'imported') params.source = source
  if (q && q.trim()) params.q = q.trim()
  return params
}

export const validateImport = form => {
  if (!form.productId) return { error: 'Choose a product.' }
  if (!/^[1-5]$/.test(String(form.rating))) return { error: 'Choose a rating from 1 to 5.' }
  if (!form.body?.trim()) return { error: 'Enter the feedback text.' }
  if (!form.displayName?.trim()) return { error: 'Enter a display name the customer agreed to.' }
  if (!form.source?.trim()) return { error: 'Say where this feedback came from.' }
  const date = new Date(form.reviewDate)
  if (!form.reviewDate || Number.isNaN(date.getTime()) || date > new Date()) return { error: 'Enter a valid past date.' }
  if (form.permissionConfirmed !== true) return { error: 'Confirm the customer gave permission to publish.' }
  return {
    payload: {
      productId: form.productId,
      rating: Number(form.rating),
      title: form.title?.trim() || '',
      body: form.body.trim(),
      displayName: form.displayName.trim(),
      source: form.source.trim(),
      reviewDate: form.reviewDate,
      permissionConfirmed: true
    }
  }
}

export const sourceLabel = review => review.source === 'imported'
  ? `Imported manually${review.imported?.source ? ` (${review.imported.source})` : ''}`
  : review.verifiedPurchase ? 'Customer · verified purchase' : 'Customer · not verified'
