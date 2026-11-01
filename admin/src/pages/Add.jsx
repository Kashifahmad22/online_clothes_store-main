import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { useBlocker, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import { backendUrl } from '../App'
import { HIGHLIGHT_OPTIONS, applyHighlight, highlightFromProduct } from '../utils/productHighlight'
import StockAdjuster from '../components/StockAdjuster'
import { isArchived, statusLabel } from '../utils/productStatus'
import { setUnsavedChanges, hasUnsavedChanges, LEAVE_MESSAGE } from '../utils/unsavedChanges'
import { resolveLoadState } from '../utils/catalogueList'
import {
  ATTRIBUTE_FIELDS, MAX_ATTRIBUTE_LENGTH, attributeError, cleanAttributes, legacyAttributeNote
} from '../utils/productAttributes'
import {
  MAX_ALT_TEXT_LENGTH, altTextError, imageProblems, imagesUnchanged, moveItem, primaryMessage, setRole
} from '../utils/productImages'

// Saved SKUs are tracked by id; stock figures change only through the stock endpoint, so they are not "edits".
const formSnapshot = (product, collectionTags) => JSON.stringify({
  product: {
    ...product,
    variants: (product.variants || []).map(variant => {
      if (!variant._id) return variant
      const copy = { ...variant }
      delete copy.stockOnHand
      delete copy.reserved
      return copy
    })
  },
  collectionTags
})

const blankProduct = () => ({
  name: '',
  slug: '',
  description: '',
  productType: 'saree',
  category: 'Sarees',
  subCategory: '',
  collections: [],
  price: '',
  mrp: '',
  status: 'draft',
  bestseller: false,
  fastSelling: false,
  details: {
    fabric: '',
    composition: '',
    variety: '',
    weavingTechnique: '',
    texture: '',
    fabricFinish: '',
    weightCategory: '',
    opacity: '',
    drape: '',
    fabricFeel: '',
    seasonalSuitability: '',
    origin: '',
    colour: '',
    pattern: '',
    border: '',
    pallu: '',
    zariType: '',
    decorativeWork: '',
    printTechnique: '',
    designStyle: '',
    occasion: '',
    sareeLength: '',
    careInstructions: '',
    whatsIncluded: '',
    blousePieceIncluded: null,
    blousePieceType: '',
    blouseFabric: '',
    blouseColour: '',
    blouseLength: '',
    blousePattern: '',
    blouseStitching: '',
    specifications: []
  },
  variants: [{ sku: '', stockOnHand: 0, options: {} }],
  images: []
})

const paiseFromRupees = value => {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN
}

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxImageSize = 8 * 1024 * 1024
const maxImageCount = 12

const IMAGE_ROLES = [
  ['primary', 'Primary'], ['full-saree', 'Full saree'], ['border', 'Border'], ['pallu', 'Pallu'],
  ['blouse', 'Blouse'], ['detail', 'Detail'], ['lifestyle', 'Lifestyle'], ['other', 'Other']
]

const ImageRow = ({ kind, position, src, image, index, total, onRole, onAlt, onMove, onRemove }) => {
  const error = altTextError(position, image.altText)
  const isPrimary = image.role === 'primary'
  return (
    <div className='flex w-full min-w-0 flex-col gap-3 border p-3 sm:flex-row' data-testid='image-row'>
      <img className='h-32 w-24 shrink-0 bg-gray-100 object-cover' src={src} alt={image.altText || ''} />
      <div className='grid min-w-0 flex-1 gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <strong className='text-sm'>Image {position}{kind === 'upload' ? ' (new)' : ''}</strong>
          {isPrimary && <span className='border border-amber-600 bg-amber-50 px-2 py-0.5 text-xs text-amber-900'>Primary image</span>}
        </div>
        <label className='grid min-w-0 gap-1 text-sm'>Alt text (optional)
          <input value={image.altText || ''} maxLength={MAX_ALT_TEXT_LENGTH + 40}
            onChange={event => onAlt(index, event.target.value)} aria-invalid={Boolean(error)}
            placeholder='Describe what the image shows' className='w-full min-w-0 px-3 py-2' />
        </label>
        {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
        <div className='flex flex-wrap items-end gap-2'>
          <label className='grid gap-1 text-sm'>Image type
            <select value={image.role || 'other'} onChange={event => onRole(kind, index, event.target.value)}
              className='px-3 py-2'>
              {IMAGE_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {!isPrimary && (
            <button type='button' onClick={() => onRole(kind, index, 'primary')} className='border px-3 py-2'>
              Make primary
            </button>
          )}
          <button type='button' disabled={index === 0} onClick={() => onMove(index, index - 1)}
            aria-label={`Move up (image ${position})`} className='border px-3 py-2 disabled:opacity-40'>Move up</button>
          <button type='button' disabled={index === total - 1} onClick={() => onMove(index, index + 1)}
            aria-label={`Move down (image ${position})`} className='border px-3 py-2 disabled:opacity-40'>Move down</button>
          <button type='button' onClick={() => onRemove(index)} aria-label={`Remove (image ${position})`}
            className='border px-3 py-2'>Remove</button>
        </div>
      </div>
    </div>
  )
}

ImageRow.propTypes = {
  kind: PropTypes.oneOf(['saved', 'upload']).isRequired,
  position: PropTypes.number.isRequired,
  src: PropTypes.string.isRequired,
  image: PropTypes.shape({ role: PropTypes.string, altText: PropTypes.string }).isRequired,
  index: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  onRole: PropTypes.func.isRequired,
  onAlt: PropTypes.func.isRequired,
  onMove: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired
}

const Add = ({ token }) => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const editId = searchParams.get('id')
  const [product, setProduct] = useState(blankProduct)
  const [collectionTags, setCollectionTags] = useState('')
  const [uploads, setUploads] = useState([])
  // Details and images exactly as stored, used so untouched legacy values are kept and not re-validated.
  const [savedDetails, setSavedDetails] = useState()
  const [savedImages, setSavedImages] = useState()
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [restoring, setRestoring] = useState(false)
  const [baseline, setBaseline] = useState(() => formSnapshot(blankProduct(), ''))
  const isDirty = uploads.length > 0 || formSnapshot(product, collectionTags) !== baseline

  useEffect(() => {
    setUnsavedChanges(isDirty)
    if (!isDirty) return undefined
    const warn = event => {
      event.preventDefault()
      event.returnValue = LEAVE_MESSAGE
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  useEffect(() => () => setUnsavedChanges(false), [])

  // Covers in-app links and the browser Back/Forward buttons. The module flag (not React state) is read
  // so that a successful save, which clears it just before navigating, is never blocked.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    hasUnsavedChanges() &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search))
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(LEAVE_MESSAGE)) {
      setUnsavedChanges(false)
      blocker.proceed()
    } else {
      blocker.reset()
    }
  }, [blocker])

  const previews = useMemo(() => uploads.map(item => ({
    ...item,
    url: URL.createObjectURL(item.file)
  })), [uploads])

  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews])

  const formKey = editId || ''
  // The load result is tagged with the product it belongs to. Whenever it differs from the current ?id=,
  // the form is treated as loading, so the previous product can never render for even one frame.
  const [loadInfo, setLoadInfo] = useState({ key: formKey, state: editId ? 'loading' : 'ready', message: '' })
  const loadState = resolveLoadState(loadInfo, formKey)
  const loadMessage = loadInfo.message
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!editId) {
      setProduct(blankProduct())
      setCollectionTags('')
      setUploads([])
      setSavedDetails(undefined)
      setSavedImages(undefined)
      setBaseline(formSnapshot(blankProduct(), ''))
      setLoadInfo({ key: '', state: 'ready', message: '' })
      return undefined
    }

    // Reset to a clean blank form so a previous product's data or dirty state can never leak in.
    setLoadInfo({ key: editId, state: 'loading', message: '' })
    setProduct(blankProduct())
    setCollectionTags('')
    setUploads([])
    setSavedDetails(undefined)
    setSavedImages(undefined)
    setBaseline(formSnapshot(blankProduct(), ''))
    const controller = new AbortController()
    axios.get(`${backendUrl}/api/product/admin/${encodeURIComponent(editId)}`, {
      headers: { token },
      signal: controller.signal
    })
      .then(({ data }) => {
        if (controller.signal.aborted) return
        const found = data.product
        if (!data.success || !found || found._id !== editId) throw new Error('The server returned an unexpected response.')
        const loaded = {
          ...blankProduct(),
          ...found,
          price: (found.pricePaise / 100).toFixed(2),
          mrp: found.mrpPaise ? (found.mrpPaise / 100).toFixed(2) : '',
          details: { ...blankProduct().details, ...found.details },
          variants: found.variants?.map(variant => ({
            ...variant,
            priceOverride: variant.priceOverridePaise == null
              ? ''
              : (variant.priceOverridePaise / 100).toFixed(2),
            options: variant.options || {}
          })) || [],
          images: found.images || []
        }
        const tags = (found.collections || []).join(', ')
        setProduct(loaded)
        setSavedDetails(found.details || {})
        setSavedImages(found.images || [])
        setCollectionTags(tags)
        setBaseline(formSnapshot(loaded, tags))
        setLoadInfo({ key: editId, state: 'ready', message: '' })
      })
      .catch(error => {
        if (axios.isCancel(error) || controller.signal.aborted) return
        if (error.response?.status === 404) {
          setLoadInfo({ key: editId, state: 'notfound', message: 'Product not found. It may have been removed.' })
        } else if (error.response?.status === 400) {
          setLoadInfo({ key: editId, state: 'notfound', message: 'This product link is not valid.' })
        } else {
          setLoadInfo({
            key: editId,
            state: 'error',
            message: error.response?.data?.message || 'Unable to load the product. Check your connection and try again.'
          })
        }
      })
    return () => controller.abort()
  }, [editId, token, reloadKey])

  const setField = (field, value) => setProduct(current => ({ ...current, [field]: value }))
  const setDetail = (field, value) => setProduct(current => ({
    ...current,
    details: { ...current.details, [field]: value }
  }))

  const addUploads = event => {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    if (product.images.length + uploads.length + selected.length > maxImageCount) {
      toast.error(`A product can have up to ${maxImageCount} images.`)
      return
    }
    const invalidFile = selected.find(file => !allowedImageTypes.has(file.type) || file.size > maxImageSize)
    if (invalidFile) {
      toast.error(!allowedImageTypes.has(invalidFile.type)
        ? `${invalidFile.name} is not a supported image. Use JPG, PNG, or WebP.`
        : `${invalidFile.name} is larger than 8 MB.`)
      return
    }
    const hasPrimaryImage = product.images.some(image => image.role === 'primary') ||
      uploads.some(item => item.role === 'primary')
    setUploads(current => [
      ...current,
      ...selected.map((file, index) => ({
        file,
        role: !hasPrimaryImage && current.length === 0 && index === 0 ? 'primary' : 'other',
        altText: ''
      }))
    ])
  }

  const setVariant = (index, field, value) => setProduct(current => ({
    ...current,
    variants: current.variants.map((variant, itemIndex) =>
      itemIndex === index ? { ...variant, [field]: value } : variant)
  }))
  const setVariantOption = (index, optionField, value) => setProduct(current => ({
    ...current,
    variants: current.variants.map((variant, itemIndex) => {
      if (itemIndex !== index) return variant
      const currentOption = Object.entries(variant.options || {})[0] || ['', '']
      const [oldName, oldValue] = currentOption
      const name = optionField === 'name' ? value : oldName
      const optionValue = optionField === 'value' ? value : oldValue
      return {
        ...variant,
        options: name ? { [name]: optionValue } : {}
      }
    })
  }))
  const setSpecification = (index, field, value) => setProduct(current => ({
    ...current,
    details: {
      ...current.details,
      specifications: current.details.specifications.map((specification, itemIndex) =>
        itemIndex === index ? { ...specification, [field]: value } : specification)
    }
  }))

  const onSubmitHandler = async event => {
    event.preventDefault()
    if (savingRef.current) return

    const pricePaise = paiseFromRupees(product.price)
    const mrpPaise = product.mrp === '' ? null : paiseFromRupees(product.mrp)
    if (!Number.isSafeInteger(pricePaise) || pricePaise < 0 ||
      (mrpPaise !== null && (!Number.isSafeInteger(mrpPaise) || mrpPaise < pricePaise))) {
      toast.error('Enter a valid price and MRP in rupees.')
      return
    }

    if (!backendUrl || !/^https?:\/\//i.test(backendUrl)) {
      toast.error('Admin API URL is not configured. Set VITE_BACKEND_URL to the backend URL.')
      return
    }
    if (!token) {
      toast.error('Your admin session is missing. Sign in again before saving.')
      return
    }
    if (product.images.length + uploads.length === 0) {
      toast.error('Add at least one product image before saving.')
      return
    }
    if (product.images.length + uploads.length > maxImageCount) {
      toast.error(`A product can have up to ${maxImageCount} images.`)
      return
    }
    if (product.status === 'published' &&
      ![...product.images, ...uploads].some(image => image.role === 'primary')) {
      toast.error('Select a primary product image before publishing.')
      return
    }
    if (product.status === 'published' && product.productType === 'saree' &&
      typeof product.details.blousePieceIncluded !== 'boolean') {
      toast.error('Specify whether the blouse piece is included before publishing.')
      return
    }
    if (product.status === 'published' && product.variants.every(variant => variant.active === false)) {
      toast.error('At least one active SKU is required before publishing.')
      return
    }

    const skus = product.variants.map(variant => variant.sku.trim().toUpperCase())
    if (skus.some(sku => !/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(sku))) {
      toast.error('Each variant needs a SKU with 2–40 letters, numbers, dots, underscores, or hyphens.')
      return
    }
    if (new Set(skus).size !== skus.length) {
      toast.error('Each product variant must have a unique SKU.')
      return
    }
    if (product.variants.some(variant =>
      !Number.isSafeInteger(Number(variant.stockOnHand)) || Number(variant.stockOnHand) < 0)) {
      toast.error('Variant stock must be a non-negative whole number.')
      return
    }
    if (product.variants.some(variant => {
      const option = Object.entries(variant.options || {})[0]
      return option && (!option[0].trim() || !option[1].trim())
    })) {
      toast.error('Complete both the option name and value, or leave both blank.')
      return
    }
    if (product.variants.some(variant => {
      if (variant.priceOverride === '' || variant.priceOverride === undefined) return false
      const override = paiseFromRupees(variant.priceOverride)
      return !Number.isSafeInteger(override) || override < 0 ||
        (mrpPaise !== null && override > mrpPaise)
    })) {
      toast.error('Enter a valid variant price no greater than the product MRP.')
      return
    }

    const attributeCheck = cleanAttributes(product.details, savedDetails)
    if (attributeCheck.errors.length > 0) {
      toast.error(attributeCheck.errors[0])
      return
    }
    const problems = imageProblems(product.images, uploads, savedImages)
    if (problems.length > 0) {
      toast.error(problems[0])
      return
    }

    const formData = new FormData()
    const payload = {
      ...product,
      collections: [...new Set(collectionTags.split(',').map(tag => tag.trim()).filter(Boolean))],
      pricePaise,
      mrpPaise,
      details: {
        ...attributeCheck.details,
        specifications: (product.details.specifications || []).filter(specification =>
          specification.label?.trim() && specification.value?.trim())
      },
      variants: product.variants.map(variant => ({
        ...variant,
        stockOnHand: Number(variant.stockOnHand),
        priceOverridePaise: variant.priceOverride === '' || variant.priceOverride === undefined
          ? null
          : paiseFromRupees(variant.priceOverride)
      }))
    }
    delete payload.price
    delete payload.lowStock
    delete payload.mrp
    payload.variants.forEach(variant => delete variant.priceOverride)
    formData.append('product', JSON.stringify(payload))
    formData.append('imageRoles', JSON.stringify(uploads.map(item => item.role)))
    formData.append('imageAlts', JSON.stringify(uploads.map(item => item.altText || '')))
    uploads.forEach(item => formData.append('images', item.file))

    savingRef.current = true
    setSaving(true)
    try {
      const url = editId
        ? `${backendUrl}/api/product/${editId}`
        : `${backendUrl}/api/product/add`
      const response = await axios({
        method: editId ? 'put' : 'post',
        url,
        data: formData,
        headers: { token }
      })
      if (!response.data.success) throw new Error(response.data.message)
      toast.success(editId
        ? 'Product updated.'
        : product.status === 'published' ? 'Product published.' : 'Product saved as a draft.')
      if (!editId) {
        setProduct(blankProduct())
        setCollectionTags('')
        setUploads([])
      }
      setUnsavedChanges(false)
      navigate('/list')
    } catch (error) {
      const message = error.response?.data?.message ||
        (error.code === 'ERR_NETWORK'
          ? 'Cannot reach the backend. Check the backend URL, server status, and allowed CORS origin.'
          : error.message || 'Unable to save product.')
      toast.error(message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const restoreToDraft = async () => {
    if (restoring || savingRef.current || !editId) return
    setRestoring(true)
    try {
      const response = await axios.patch(
        `${backendUrl}/api/product/${editId}/status`,
        { status: 'draft' },
        { headers: { token } }
      )
      if (!response.data.success) throw new Error(response.data.message)
      setProduct(current => ({ ...current, status: 'draft' }))
      setBaseline(current => {
        const parsed = JSON.parse(current)
        parsed.product.status = 'draft'
        return JSON.stringify(parsed)
      })
      toast.success('Product restored to Draft. It is not published.')
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to restore product.')
    } finally {
      setRestoring(false)
    }
  }

  const applyStockSummary = summary => setProduct(current => ({
    ...current,
    variants: current.variants.map(variant => variant._id === summary._id
      ? { ...variant, stockOnHand: summary.stockOnHand, reserved: summary.reserved }
      : variant)
  }))

  const deactivateVariant = index => {
    const variant = product.variants[index]
    if (!window.confirm(`Deactivate SKU ${variant.sku}? It will stop being sold once you save. Order history and stock records are kept, and you can reactivate it later.`)) return
    setVariant(index, 'active', false)
  }

  const applyImageChange = ({ saved, uploads: nextUploads }) => {
    setProduct(current => ({ ...current, images: saved }))
    setUploads(nextUploads)
  }
  const changeRole = (kind, index, role) =>
    applyImageChange(setRole(product.images, uploads, kind, index, role))
  const setSavedAlt = (index, altText) => setProduct(current => ({
    ...current,
    images: current.images.map((image, imageIndex) => (imageIndex === index ? { ...image, altText } : image))
  }))
  const setUploadAlt = (index, altText) => setUploads(current =>
    current.map((upload, i) => (i === index ? { ...upload, altText } : upload)))
  const moveSaved = (from, to) => setProduct(current => ({ ...current, images: moveItem(current.images, from, to) }))
  const moveUpload = (from, to) => setUploads(current => moveItem(current, from, to))

  const removeExistingImage = index => setProduct(current => ({
    ...current,
    images: current.images.filter((_, imageIndex) => imageIndex !== index)
  }))

  if (loadState !== 'ready') {
    return (
      <section className='text-sm'>
        {loadState === 'loading' && <p role='status' className='py-6 text-gray-500'>Loading product…</p>}
        {loadState !== 'loading' && (
          <div role='alert' className='border border-red-300 bg-red-50 p-4'>
            <p className='text-red-700'>{loadMessage}</p>
            <div className='mt-3 flex gap-2'>
              {loadState === 'error' && (
                <button type='button' onClick={() => setReloadKey(key => key + 1)} className='border px-4 py-2'>Retry</button>
              )}
              <button type='button' onClick={() => navigate('/list')} className='border px-4 py-2'>Back to catalogue</button>
            </div>
          </div>
        )}
      </section>
    )
  }

  return (
    <form onSubmit={onSubmitHandler} className='flex flex-col w-full items-start gap-5'>
      <h1 className='text-xl font-medium'>{editId ? 'Edit product' : 'Add product'}</h1>

      <section className='w-full grid gap-3'>
        <h2 className='font-medium'>Product basics</h2>
        <input required value={product.name} onChange={event => setField('name', event.target.value)}
          className='w-full max-w-[600px] px-3 py-2' placeholder='Product name' />
        <input value={product.slug || ''} onChange={event => setField('slug', event.target.value)}
          className='w-full max-w-[600px] px-3 py-2' placeholder='URL slug (optional; generated from name)' />
        <textarea required value={product.description} onChange={event => setField('description', event.target.value)}
          className='w-full max-w-[600px] px-3 py-2' rows='4' placeholder='Accurate product description' />
        <div className='flex flex-wrap gap-3'>
          <select value={product.productType} onChange={event => setField('productType', event.target.value)} className='px-3 py-2'>
            <option value='saree'>Saree</option>
            <option value='suit'>Suit</option>
            <option value='suit-set'>Suit set</option>
            <option value='dress'>Dress</option>
            <option value='suit-piece'>Suit piece / dress material</option>
            <option value='lehenga'>Lehenga</option>
            <option value='kurti'>Kurti</option>
            <option value='other'>Other ethnic wear</option>
          </select>
          <input required value={product.category} onChange={event => setField('category', event.target.value)}
            className='px-3 py-2' placeholder='Category' />
          <input value={product.subCategory} onChange={event => setField('subCategory', event.target.value)}
            className='px-3 py-2' placeholder='Subcategory (optional)' />
        </div>
        <label className='grid gap-1 w-full max-w-[600px]'>Collection tags
          <input value={collectionTags} onChange={event => setCollectionTags(event.target.value)}
            className='px-3 py-2' placeholder='For example: Dhanteras, Silk Sarees (comma-separated)' />
          <span className='text-sm text-gray-500'>Tags power collection and festive campaign pages. Enter only collections this product belongs to.</span>
        </label>
        <div className='flex flex-wrap gap-3'>
          <label className='grid gap-1'>Selling price (₹)
            <input required min='0' step='0.01' type='number' value={product.price}
              onChange={event => setField('price', event.target.value)} className='px-3 py-2' />
          </label>
          <label className='grid gap-1'>MRP (₹, optional)
            <input min='0' step='0.01' type='number' value={product.mrp}
              onChange={event => setField('mrp', event.target.value)} className='px-3 py-2' />
          </label>
          <div className='grid gap-1'>Status
            {isArchived(product.status) ? (
              <div className='flex flex-wrap items-center gap-2'>
                <span className='px-3 py-2 border bg-gray-100'>{statusLabel('archived')}</span>
                <button type='button' onClick={restoreToDraft} disabled={restoring || saving}
                  className='border px-3 py-2 disabled:opacity-40'>
                  {restoring ? 'Restoring…' : 'Restore to Draft'}
                </button>
                <span className='text-xs text-gray-500'>Restoring keeps the product hidden until you publish it.</span>
              </div>
            ) : (
              <select value={product.status} onChange={event => setField('status', event.target.value)} className='px-3 py-2'>
                <option value='draft'>Draft</option>
                <option value='published'>Published</option>
              </select>
            )}
          </div>
        </div>
      </section>

      <section className='w-full grid gap-3'>
        <h2 className='font-medium'>Fabric and colour</h2>
        <p className='text-sm text-gray-600'>
          Optional. Shown on product cards when filled in. Enter only what is true for this product; leave blank if
          unknown. Placeholders such as N/A or None are not accepted.
        </p>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[800px]'>
          {ATTRIBUTE_FIELDS.map(({ key, label, placeholder }) => {
            const error = attributeError(label, product.details[key], savedDetails?.[key])
            const note = legacyAttributeNote(label, product.details[key], savedDetails?.[key])
            return (
              <label key={key} className='grid min-w-0 gap-1'>{label} (optional)
                <input value={product.details[key] || ''} maxLength={MAX_ATTRIBUTE_LENGTH + 20}
                  onChange={event => setDetail(key, event.target.value)} placeholder={placeholder}
                  aria-invalid={Boolean(error)} className='w-full min-w-0 px-3 py-2' />
                {error && <span role='alert' className='text-sm text-red-700'>{error}</span>}
                {note && <span role='status' className='text-sm text-amber-800'>{note}</span>}
              </label>
            )
          })}
        </div>
      </section>

      {product.productType === 'saree' && (
        <section className='w-full grid grid-cols-1 gap-3'>
          <h2 className='font-medium'>Saree details</h2>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[800px]'>
            {[
              ['composition', 'Composition (only if known)'],
              ['variety', 'Silk / cotton variety (if known)'],
              ['weavingTechnique', 'Weaving technique (if verified)'],
              ['texture', 'Texture / finish'],
              ['fabricFinish', 'Fabric finish'],
              ['weightCategory', 'Weight category (if known)'],
              ['opacity', 'Transparency / opacity (if known)'],
              ['drape', 'Drape characteristics (if known)'],
              ['fabricFeel', 'Fabric feel (if known)'],
              ['seasonalSuitability', 'Seasonal suitability (if known)'],
              ['origin', 'Origin / place of manufacture (if verified)'],
              ['pattern', 'Pattern'],
              ['border', 'Border details'],
              ['pallu', 'Pallu details'],
              ['zariType', 'Zari type (if known)'],
              ['decorativeWork', 'Decorative work / embroidery'],
              ['printTechnique', 'Print technique (if known)'],
              ['designStyle', 'Design style'],
              ['occasion', 'Suitable occasion (if known)'],
              ['sareeLength', 'Saree length'],
              ['careInstructions', 'Care instructions'],
              ['whatsIncluded', 'Exactly what is included']
            ].map(([field, label]) => (
              <label key={field} className='grid min-w-0 gap-1'>{label}
                <input value={product.details[field] || ''} onChange={event => setDetail(field, event.target.value)}
                  className='w-full min-w-0 px-3 py-2' />
              </label>
            ))}
          </div>
          <label className='grid grid-cols-1 gap-1 w-full sm:w-fit'>Blouse piece inclusion
            <select value={product.details.blousePieceIncluded === true ? 'yes'
              : product.details.blousePieceIncluded === false ? 'no' : ''}
              onChange={event => setDetail('blousePieceIncluded',
                event.target.value === '' ? null : event.target.value === 'yes')}
              className='px-3 py-2 w-full min-w-0'>
              <option value=''>Select actual product information</option>
              <option value='yes'>Included</option>
              <option value='no'>Not included</option>
            </select>
          </label>
          {product.details.blousePieceIncluded && (
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[800px]'>
              {[
                ['blousePieceType', 'Attached or separate'],
                ['blouseFabric', 'Blouse fabric'],
                ['blouseColour', 'Blouse colour'],
                ['blouseLength', 'Blouse length'],
                ['blousePattern', 'Blouse pattern'],
                ['blouseStitching', 'Stitched / unstitched']
              ].map(([field, label]) => (
                <label key={field} className='grid min-w-0 gap-1'>{label}
                  <input value={product.details[field] || ''} onChange={event => setDetail(field, event.target.value)}
                    className='w-full min-w-0 px-3 py-2' />
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      <section className='w-full grid gap-3'>
        <h2 className='font-medium'>Inventory and SKU</h2>
        {product.variants.map((variant, index) => {
          const saved = Boolean(variant._id)
          const inactive = variant.active === false
          return (
          <div key={variant._id || index} className={`grid gap-2 border p-2 ${inactive ? 'bg-gray-50' : ''}`}>
          <div className='flex flex-wrap gap-3 items-end'>
            <label className='grid gap-1'>SKU
              <input required readOnly={saved} value={variant.sku} onChange={event => setVariant(index, 'sku', event.target.value)}
                className={`px-3 py-2 ${saved ? 'bg-gray-100 text-gray-600' : ''}`} />
            </label>
            {saved ? (
              <span className={`px-2 py-1 text-xs border ${inactive ? 'text-gray-600' : 'text-green-800'}`}>
                {inactive ? 'Inactive' : 'Active'}
              </span>
            ) : (
              <label className='grid gap-1'>Initial stock
                <input required min='0' step='1' type='number' value={variant.stockOnHand}
                  onChange={event => setVariant(index, 'stockOnHand', event.target.value)} className='px-3 py-2' />
              </label>
            )}
            <label className='grid gap-1'>Price override (₹, optional)
              <input min='0' step='0.01' type='number' value={variant.priceOverride || ''}
                onChange={event => setVariant(index, 'priceOverride', event.target.value)} className='px-3 py-2' />
            </label>
            <label className='grid gap-1'>Option (optional)
              <input value={Object.keys(variant.options || {})[0] || ''}
                onChange={event => setVariantOption(index, 'name', event.target.value)}
                className='px-3 py-2' placeholder='Colour / size' />
            </label>
            <label className='grid gap-1'>Option value
              <input value={Object.values(variant.options || {})[0] || ''}
                onChange={event => setVariantOption(index, 'value', event.target.value)}
                className='px-3 py-2' placeholder='Red / Standard' />
            </label>
            {saved ? (
              inactive ? (
                <button type='button' onClick={() => setVariant(index, 'active', true)}
                  className='border px-3 py-2'>Reactivate SKU</button>
              ) : (
                <button type='button' onClick={() => deactivateVariant(index)}
                  className='border px-3 py-2'>Deactivate SKU</button>
              )
            ) : (
              <button type='button' disabled={product.variants.length === 1}
                onClick={() => setProduct(current => ({ ...current, variants: current.variants.filter((_, i) => i !== index) }))}
                className='border px-3 py-2 disabled:opacity-40'>Remove new SKU</button>
            )}
          </div>
          {saved && editId && (
            <StockAdjuster token={token} productId={editId} variant={variant} onUpdated={applyStockSummary} />
          )}
          </div>
          )
        })}
        <button type='button' onClick={() => setProduct(current => ({
          ...current,
          variants: [...current.variants, { sku: '', stockOnHand: 0, options: {} }]
        }))} className='border px-3 py-2 w-fit'>Add SKU / variant</button>
      </section>

      <section className='w-full grid gap-3'>
        <h2 className='font-medium'>Additional specifications</h2>
        <p className='text-sm text-gray-500'>Add only product facts you have verified. Leave irrelevant fields blank.</p>
        {(product.details.specifications || []).map((specification, index) => (
          <div key={index} className='flex flex-wrap gap-3'>
            <input value={specification.label || ''} onChange={event => setSpecification(index, 'label', event.target.value)}
              className='px-3 py-2' placeholder='Specification name' />
            <input value={specification.value || ''} onChange={event => setSpecification(index, 'value', event.target.value)}
              className='px-3 py-2' placeholder='Verified value' />
            <button type='button' onClick={() => setProduct(current => ({
              ...current,
              details: {
                ...current.details,
                specifications: current.details.specifications.filter((_, itemIndex) => itemIndex !== index)
              }
            }))} className='border px-3 py-2'>Remove</button>
          </div>
        ))}
        <button type='button' onClick={() => setProduct(current => ({
          ...current,
          details: {
            ...current.details,
            specifications: [...(current.details.specifications || []), { label: '', value: '' }]
          }
        }))} className='border px-3 py-2 w-fit'>Add specification</button>
      </section>

      <section className='w-full grid gap-3'>
        <h2 className='font-medium'>Product images</h2>
        <p className='text-sm text-gray-500'>
          JPG, PNG, or WebP; up to 12 images, 8 MB each. Exactly one image is the primary image shown on cards and
          first in the gallery. New uploads are added after saved images. Alt text describes the image for screen
          readers and search engines; leave it blank to use the product name.
        </p>
        {primaryMessage(product.images, uploads) && (
          imagesUnchanged(product.images, uploads, savedImages)
            ? <p role='status' className='text-sm text-amber-800 border border-amber-300 bg-amber-50 p-2'>
              {primaryMessage(product.images, uploads)} Saving other changes still works; choosing a primary is only
              required when you change the images.
            </p>
            : <p role='alert' className='text-sm text-red-700 border border-red-300 bg-red-50 p-2'>
              {primaryMessage(product.images, uploads)}
            </p>
        )}
        {product.images.map((image, index) => (
          <ImageRow key={image.url} kind='saved' position={index + 1} src={image.url} image={image}
            index={index} total={product.images.length} onRole={changeRole} onAlt={setSavedAlt} onMove={moveSaved}
            onRemove={removeExistingImage} />
        ))}
        {previews.map((item, index) => (
          <ImageRow key={`${item.file.name}-${index}`} kind='upload' position={product.images.length + index + 1}
            src={item.url} image={item} index={index} total={previews.length} onRole={changeRole}
            onAlt={setUploadAlt} onMove={moveUpload}
            onRemove={i => setUploads(current => current.filter((_, j) => j !== i))} />
        ))}
        <input type='file' accept='image/jpeg,image/png,image/webp' multiple onChange={addUploads} className='w-full min-w-0 max-w-full' />
      </section>

      <section className='w-full grid gap-2'>
        <h2 className='font-medium'>Product highlights</h2>
        <label className='grid gap-1 sm:max-w-xs'>
          <span className='text-sm font-medium'>Product badge</span>
          <select value={highlightFromProduct(product)}
            onChange={event => setProduct(current => applyHighlight(current, event.target.value))}
            className='px-3 py-2'>
            {HIGHLIGHT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <p className='text-sm text-gray-600'>
          Shown to customers on the product and in listings. Only choose a badge that is true for this product.
        </p>
        <p className='text-sm text-gray-600'>
          <strong>Low Stock</strong> is added automatically when only a few pieces are left in the inventory below.
          It cannot be switched on by hand, and customers never see the exact number.
        </p>
      </section>
      <button disabled={saving} type='submit' className='px-6 py-3 bg-black text-white disabled:opacity-50'>
        {saving ? 'Saving…' : editId ? 'Save changes' : 'Save product'}
      </button>
    </form>
  )
}

Add.propTypes = { token: PropTypes.string.isRequired }

export default Add
