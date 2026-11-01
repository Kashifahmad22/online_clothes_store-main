import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import { backendUrl } from '../App'
import { HIGHLIGHT_OPTIONS, applyHighlight, highlightFromProduct } from '../utils/productHighlight'

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

const Add = ({ token }) => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const editId = searchParams.get('id')
  const [product, setProduct] = useState(blankProduct)
  const [collectionTags, setCollectionTags] = useState('')
  const [uploads, setUploads] = useState([])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const previews = useMemo(() => uploads.map(item => ({
    ...item,
    url: URL.createObjectURL(item.file)
  })), [uploads])

  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews])

  useEffect(() => {
    if (!editId) {
      setProduct(blankProduct())
      setCollectionTags('')
      return
    }

    axios.get(`${backendUrl}/api/product/admin/list`, { headers: { token } })
      .then(({ data }) => {
        const found = data.products?.find(item => item._id === editId)
        if (!found) {
          toast.error('Product not found.')
          return
        }
        setProduct({
          ...blankProduct(),
          ...found,
          price: (found.pricePaise / 100).toFixed(2),
          mrp: found.mrpPaise ? (found.mrpPaise / 100).toFixed(2) : '',
          details: { ...blankProduct().details, ...found.details },
          variants: found.variants?.map(variant => ({
            ...variant,
            priceOverride: variant.priceOverridePaise === undefined
              ? ''
              : (variant.priceOverridePaise / 100).toFixed(2),
            options: variant.options || {}
          })) || [],
          images: found.images || []
        })
        setCollectionTags((found.collections || []).join(', '))
      })
      .catch(() => toast.error('Unable to load product for editing.'))
  }, [editId, token])

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
        role: !hasPrimaryImage && current.length === 0 && index === 0 ? 'primary' : 'other'
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
    const mrpPaise = product.mrp === '' ? undefined : paiseFromRupees(product.mrp)
    if (!Number.isSafeInteger(pricePaise) || pricePaise < 0 ||
      (mrpPaise !== undefined && (!Number.isSafeInteger(mrpPaise) || mrpPaise < pricePaise))) {
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
        (mrpPaise !== undefined && override > mrpPaise)
    })) {
      toast.error('Enter a valid variant price no greater than the product MRP.')
      return
    }

    const formData = new FormData()
    const payload = {
      ...product,
      collections: [...new Set(collectionTags.split(',').map(tag => tag.trim()).filter(Boolean))],
      pricePaise,
      mrpPaise,
      details: {
        ...product.details,
        specifications: (product.details.specifications || []).filter(specification =>
          specification.label?.trim() && specification.value?.trim())
      },
      variants: product.variants.map(variant => ({
        ...variant,
        stockOnHand: Number(variant.stockOnHand),
        priceOverridePaise: variant.priceOverride === ''
          ? undefined
          : paiseFromRupees(variant.priceOverride)
      }))
    }
    delete payload.price
    delete payload.lowStock
    delete payload.mrp
    payload.variants.forEach(variant => delete variant.priceOverride)
    formData.append('product', JSON.stringify(payload))
    formData.append('imageRoles', JSON.stringify(uploads.map(item => item.role)))
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

  const setExistingImageRole = (index, role) => setProduct(current => ({
    ...current,
    images: current.images.map((image, imageIndex) =>
      imageIndex === index ? { ...image, role } : image)
  }))

  const removeExistingImage = index => setProduct(current => ({
    ...current,
    images: current.images.filter((_, imageIndex) => imageIndex !== index)
  }))

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
          <label className='grid gap-1'>Status
            <select value={product.status} onChange={event => setField('status', event.target.value)} className='px-3 py-2'>
              <option value='draft'>Draft</option>
              <option value='published'>Published</option>
            </select>
          </label>
        </div>
      </section>

      {product.productType === 'saree' && (
        <section className='w-full grid gap-3'>
          <h2 className='font-medium'>Saree details</h2>
          <div className='grid sm:grid-cols-2 gap-3 max-w-[800px]'>
            {[
              ['fabric', 'Fabric'],
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
              ['colour', 'Colour'],
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
              <label key={field} className='grid gap-1'>{label}
                <input value={product.details[field] || ''} onChange={event => setDetail(field, event.target.value)}
                  className='px-3 py-2' />
              </label>
            ))}
          </div>
          <label className='grid gap-1 w-fit'>Blouse piece inclusion
            <select value={product.details.blousePieceIncluded === true ? 'yes'
              : product.details.blousePieceIncluded === false ? 'no' : ''}
              onChange={event => setDetail('blousePieceIncluded',
                event.target.value === '' ? null : event.target.value === 'yes')}
              className='px-3 py-2'>
              <option value=''>Select actual product information</option>
              <option value='yes'>Included</option>
              <option value='no'>Not included</option>
            </select>
          </label>
          {product.details.blousePieceIncluded && (
            <div className='grid sm:grid-cols-2 gap-3 max-w-[800px]'>
              {[
                ['blousePieceType', 'Attached or separate'],
                ['blouseFabric', 'Blouse fabric'],
                ['blouseColour', 'Blouse colour'],
                ['blouseLength', 'Blouse length'],
                ['blousePattern', 'Blouse pattern'],
                ['blouseStitching', 'Stitched / unstitched']
              ].map(([field, label]) => (
                <label key={field} className='grid gap-1'>{label}
                  <input value={product.details[field] || ''} onChange={event => setDetail(field, event.target.value)}
                    className='px-3 py-2' />
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      <section className='w-full grid gap-3'>
        <h2 className='font-medium'>Inventory and SKU</h2>
        {product.variants.map((variant, index) => (
          <div key={index} className='flex flex-wrap gap-3 items-end'>
            <label className='grid gap-1'>SKU
              <input required value={variant.sku} onChange={event => setVariant(index, 'sku', event.target.value)}
                className='px-3 py-2' />
            </label>
            <label className='grid gap-1'>Stock on hand
              <input required min='0' step='1' type='number' value={variant.stockOnHand}
                onChange={event => setVariant(index, 'stockOnHand', event.target.value)} className='px-3 py-2' />
            </label>
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
            <button type='button' disabled={product.variants.length === 1}
              onClick={() => setProduct(current => ({ ...current, variants: current.variants.filter((_, i) => i !== index) }))}
              className='border px-3 py-2 disabled:opacity-40'>Remove SKU</button>
          </div>
        ))}
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
        <p className='text-sm text-gray-500'>JPG, PNG, or WebP; up to 12 images, 8 MB each.</p>
        {product.images.map((image, index) => (
          <div key={image.url} className='flex gap-3 items-center'>
            <img className='w-16 h-20 object-cover' src={image.url} alt={image.altText || ''} />
            <select value={image.role || 'other'} onChange={event => setExistingImageRole(index, event.target.value)}
              className='px-3 py-2'>
              <option value='primary'>Primary</option>
              <option value='full-saree'>Full saree</option>
              <option value='border'>Border</option>
              <option value='pallu'>Pallu</option>
              <option value='blouse'>Blouse</option>
              <option value='detail'>Detail</option>
              <option value='lifestyle'>Lifestyle</option>
              <option value='other'>Other</option>
            </select>
            <button type='button' onClick={() => removeExistingImage(index)} className='border px-3 py-2'>Remove</button>
          </div>
        ))}
        {previews.map((item, index) => (
          <div key={`${item.file.name}-${index}`} className='flex gap-3 items-center'>
            <img className='w-16 h-20 object-cover' src={item.url} alt='' />
            <select value={item.role} onChange={event => setUploads(current =>
              current.map((upload, i) => i === index ? { ...upload, role: event.target.value } : upload))}
              className='px-3 py-2'>
              <option value='primary'>Primary</option>
              <option value='full-saree'>Full saree</option>
              <option value='border'>Border</option>
              <option value='pallu'>Pallu</option>
              <option value='blouse'>Blouse</option>
              <option value='detail'>Detail</option>
              <option value='lifestyle'>Lifestyle</option>
              <option value='other'>Other</option>
            </select>
            <button type='button' onClick={() => setUploads(current => current.filter((_, i) => i !== index))}
              className='border px-3 py-2'>Remove</button>
          </div>
        ))}
        <input type='file' accept='image/jpeg,image/png,image/webp' multiple onChange={addUploads} />
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
