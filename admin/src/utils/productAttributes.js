// Fabric and colour are optional, admin-entered text stored in product.details. They are never inferred.
// The placeholder rule is mirrored in backend/utils/catalogueValidation.js and the storefront; a drift test keeps them equal.
export const PLACEHOLDER_VALUE = /^(?:n\/?a|na|none|null|undefined|nil|tbd|not specified|unknown|-+|\.+)$/i
export const MAX_ATTRIBUTE_LENGTH = 80

export const ATTRIBUTE_FIELDS = [
  { key: 'fabric', label: 'Fabric / material', placeholder: 'e.g. Banarasi silk' },
  { key: 'colour', label: 'Colour', placeholder: 'e.g. Maroon' }
]

export const tidyAttribute = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

// A value equal to what is already stored is a legacy value: it is kept as stored and is not re-validated,
// so an unrelated edit is never blocked by an old placeholder. Mirrors backend normaliseDetailAttributes.
export const isUnchangedAttribute = (current, original) =>
  original !== undefined &&
  (current === original || (typeof current === 'string' && typeof original === 'string' &&
    tidyAttribute(current) === tidyAttribute(original)))

// Returns an error message, or '' when the value is acceptable (blank is acceptable: the field is optional).
export const attributeError = (label, value, original) => {
  if (isUnchangedAttribute(value, original)) return ''
  const text = tidyAttribute(value)
  if (!text) return ''
  if (PLACEHOLDER_VALUE.test(text)) return `${label} cannot be "${text}". Leave it blank if unknown.`
  if (text.length > MAX_ATTRIBUTE_LENGTH) return `${label} must be ${MAX_ATTRIBUTE_LENGTH} characters or fewer.`
  return ''
}

// Explains a saved value that would be rejected if typed today. The saved value is kept until the admin changes it.
export const legacyAttributeNote = (label, value, original) =>
  isUnchangedAttribute(value, original) && attributeError(label, original) !== ''
    ? `The saved ${label.toLowerCase()} "${tidyAttribute(original)}" looks like a placeholder. It is kept as is; replace or clear it when you can.`
    : ''

// Trims fabric and colour and leaves every other detail exactly as it was. `original` is the stored details object
// of the product being edited (undefined when creating): unchanged values are preserved exactly as stored.
export const cleanAttributes = (details, original) => {
  const cleaned = { ...details }
  const errors = []
  for (const { key, label } of ATTRIBUTE_FIELDS) {
    const error = attributeError(label, details?.[key], original?.[key])
    if (error) errors.push(error)
    cleaned[key] = isUnchangedAttribute(details?.[key], original?.[key]) ? original[key] : tidyAttribute(details?.[key])
  }
  return { details: cleaned, errors }
}
