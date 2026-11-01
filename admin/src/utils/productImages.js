// Image list helpers for the product form. Saved images and new uploads are separate lists (saved first, as the
// backend stores them); on save the backend also places the single primary image first.
export const MAX_ALT_TEXT_LENGTH = 160

export const moveItem = (list, from, to) => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export const altTextError = (position, value) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > MAX_ALT_TEXT_LENGTH
    ? `Image ${position} alt text must be ${MAX_ALT_TEXT_LENGTH} characters or fewer.`
    : ''
}

export const countPrimary = (saved, uploads) =>
  [...saved, ...uploads].filter(image => image.role === 'primary').length

// Makes exactly one image primary: every other primary becomes "other", and the new one moves to the front of its list.
export const setPrimary = (saved, uploads, kind, index) => {
  const demote = list => list.map(image => (image.role === 'primary' ? { ...image, role: 'other' } : image))
  const promote = list => moveItem(list.map((image, i) => (i === index ? { ...image, role: 'primary' } : image)), index, 0)
  return {
    saved: kind === 'saved' ? promote(demote(saved)) : demote(saved),
    uploads: kind === 'upload' ? promote(demote(uploads)) : demote(uploads)
  }
}

// Changing the role of one image keeps the single-primary rule.
export const setRole = (saved, uploads, kind, index, role) => {
  if (role === 'primary') return setPrimary(saved, uploads, kind, index)
  const apply = list => list.map((image, i) => (i === index ? { ...image, role } : image))
  return { saved: kind === 'saved' ? apply(saved) : saved, uploads: kind === 'upload' ? apply(uploads) : uploads }
}

// Saved images left exactly as loaded (no upload, same files, roles, alt text and order) are legacy data the admin
// is not editing, so they are not re-validated. Mirrors backend imagesUnchanged.
export const imagesUnchanged = (saved, uploads, original) =>
  uploads.length === 0 && Array.isArray(original) && saved.length === original.length &&
  saved.every((image, i) => image.url === original[i].url &&
    (image.role || 'other') === (original[i].role || 'other') &&
    (image.altText || '') === (original[i].altText || ''))

export const primaryMessage = (saved, uploads) => {
  const count = countPrimary(saved, uploads)
  if (saved.length + uploads.length === 0 || count === 1) return ''
  return count === 0
    ? 'No image is marked as the primary image. Use "Make primary" on one image.'
    : 'More than one image is marked as primary. Use "Make primary" to choose a single one.'
}

export const imageProblems = (saved, uploads, original) => {
  if (imagesUnchanged(saved, uploads, original)) return []
  const problems = []
  const all = [...saved, ...uploads]
  all.forEach((image, i) => {
    const error = altTextError(i + 1, image.altText)
    if (error) problems.push(error)
  })
  const primary = primaryMessage(saved, uploads)
  if (primary) problems.push(primary)
  return problems
}
