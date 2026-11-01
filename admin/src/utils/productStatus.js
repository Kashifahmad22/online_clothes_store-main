export const STATUS_LABELS = { draft: 'Draft', published: 'Published', archived: 'Archived' }

export const statusLabel = status => STATUS_LABELS[status] || 'Draft'
export const isArchived = status => status === 'archived'

// Statuses an admin may choose in the form. An archived product is changed only through Restore to Draft.
export const selectableStatuses = status =>
  isArchived(status) ? [] : ['draft', 'published']

export const statusButtons = status => {
  if (status === 'published') return [{ action: 'draft', label: 'Unpublish', confirm: true }, { action: 'archived', label: 'Archive', confirm: true }]
  if (status === 'archived') return [{ action: 'draft', label: 'Restore to Draft', confirm: false }]
  return [{ action: 'published', label: 'Publish', confirm: false }, { action: 'archived', label: 'Archive', confirm: true }]
}

export const statusConfirmMessage = (action, name) => {
  if (action === 'archived') return `Archive "${name}"? It will be hidden from the store.`
  if (action === 'draft') return `Unpublish "${name}"? It will be hidden from the store until published again.`
  return ''
}
