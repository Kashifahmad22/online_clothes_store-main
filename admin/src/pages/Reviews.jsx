import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { toast } from 'react-toastify'
import { backendUrl } from '../App'
import {
  REVIEW_STATUSES, STATUS_LABELS, buildListParams, moderationActions, sourceLabel, validateImport, validateModerationInput
} from '../utils/reviews'

const when = value => value ? new Date(value).toLocaleString('en-IN') : '—'
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n)
const message = (error, fallback) => error?.response?.data?.message || fallback

const ReviewDetail = ({ id, token, onChanged }) => {
  const [data, setData] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data: result } = await axios.get(`${backendUrl}/api/review/admin/${id}`, { headers: { token } })
      setData(result)
    } catch (error) { toast.error(message(error, 'Could not load the review.')) }
  }, [id, token])
  useEffect(() => { load() }, [load])

  const moderate = async action => {
    if (busy) return
    const checked = validateModerationInput(action, reason)
    if (checked.error) { toast.error(checked.error); return }
    setBusy(true)
    try {
      await axios.patch(`${backendUrl}/api/review/admin/${id}/moderate`, { action, reason: checked.reason }, { headers: { token } })
      toast.success('Review updated.')
      setReason('')
      await load()
      onChanged()
    } catch (error) { toast.error(message(error, 'Could not update the review.')) } finally { setBusy(false) }
  }

  if (!data) return <p className='p-3 text-sm'>Loading…</p>
  const { review, order } = data
  return (
    <div className='border-t bg-gray-50 p-3 text-sm space-y-2'>
      <p><span className='font-medium'>Product:</span> {review.productName || review.productId}</p>
      <p><span className='font-medium'>Origin:</span> {sourceLabel(review)}</p>
      {review.source === 'imported' && (
        <p>Feedback date {when(review.imported?.reviewDate)} · permission to publish confirmed: {review.imported?.permissionConfirmed ? 'yes' : 'no'}</p>
      )}
      {order && <p>Order {order._id} · {order.status} · {order.paymentStatus} ({order.paymentMethod})</p>}
      <p className='whitespace-pre-line break-words'>{review.body}</p>
      {review.images?.length > 0 && (
        <ul className='flex flex-wrap gap-2'>
          {review.images.map((image, index) => (
            <li key={image.url}>
              <a href={image.url} target='_blank' rel='noopener noreferrer'>
                <img src={image.url} alt={`Customer photo ${index + 1}`} className='h-20 w-20 rounded object-cover' />
              </a>
            </li>
          ))}
        </ul>
      )}
      <div>
        <label className='block font-medium' htmlFor={`reason-${id}`}>Reason (required to reject, hide or flag)</label>
        <input id={`reason-${id}`} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} className='mt-1 w-full border px-2 py-1' />
        <div className='mt-2 flex flex-wrap gap-2'>
          {moderationActions(review.status).map(item => (
            <button key={item.action} type='button' disabled={busy} onClick={() => moderate(item.action)} className='border px-3 py-1 disabled:opacity-50'>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className='font-medium'>History</p>
        <ul className='list-disc pl-5'>
          {(review.moderation || []).map((entry, index) => (
            <li key={`${entry.at}-${index}`}>{when(entry.at)} · {entry.action} by {entry.actor}{entry.to ? ` → ${entry.to}` : ''}{entry.reason ? ` — ${entry.reason}` : ''}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
ReviewDetail.propTypes = { id: PropTypes.string.isRequired, token: PropTypes.string.isRequired, onChanged: PropTypes.func.isRequired }

const emptyImport = { productId: '', rating: '', title: '', body: '', displayName: '', source: '', reviewDate: '', permissionConfirmed: false }

const ImportForm = ({ token, onImported }) => {
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(emptyImport)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    axios.get(`${backendUrl}/api/product/admin/list`, { headers: { token }, params: { limit: 100 } })
      .then(({ data }) => setProducts(data.products || []))
      .catch(() => {})
  }, [token])
  const set = key => event => setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })

  const submit = async event => {
    event.preventDefault()
    if (busy) return
    const checked = validateImport(form)
    if (checked.error) { toast.error(checked.error); return }
    setBusy(true)
    try {
      await axios.post(`${backendUrl}/api/review/admin/import`, checked.payload, { headers: { token } })
      toast.success('Feedback added as a manually imported review.')
      setForm(emptyImport)
      onImported()
    } catch (error) { toast.error(message(error, 'Could not add the feedback.')) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className='border bg-white p-3 text-sm grid gap-2 sm:grid-cols-2' aria-label='Add genuine customer feedback'>
      <p className='sm:col-span-2 text-gray-700'>Only enter genuine feedback the customer agreed to publish. It is labelled as manually imported and is never shown as a verified purchase.</p>
      <label>Product
        <select value={form.productId} onChange={set('productId')} className='mt-1 w-full border px-2 py-1'>
          <option value=''>Select…</option>
          {products.map(product => <option key={product._id} value={product._id}>{product.name}</option>)}
        </select>
      </label>
      <label>Rating
        <select value={form.rating} onChange={set('rating')} className='mt-1 w-full border px-2 py-1'>
          <option value=''>Select…</option>
          {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label>Display name
        <input value={form.displayName} maxLength={60} onChange={set('displayName')} className='mt-1 w-full border px-2 py-1' />
      </label>
      <label>Source (e.g. WhatsApp, in-store)
        <input value={form.source} maxLength={100} onChange={set('source')} className='mt-1 w-full border px-2 py-1' />
      </label>
      <label>Feedback date
        <input type='date' value={form.reviewDate} onChange={set('reviewDate')} className='mt-1 w-full border px-2 py-1' />
      </label>
      <label>Title (optional)
        <input value={form.title} maxLength={100} onChange={set('title')} className='mt-1 w-full border px-2 py-1' />
      </label>
      <label className='sm:col-span-2'>Feedback
        <textarea value={form.body} maxLength={2000} rows={3} onChange={set('body')} className='mt-1 w-full border px-2 py-1' />
      </label>
      <label className='sm:col-span-2 flex items-center gap-2'>
        <input type='checkbox' checked={form.permissionConfirmed} onChange={set('permissionConfirmed')} />
        The customer gave permission to publish this feedback
      </label>
      <div className='sm:col-span-2'>
        <button type='submit' disabled={busy} className='bg-black px-4 py-2 text-white disabled:opacity-50'>{busy ? 'Saving…' : 'Add feedback'}</button>
      </div>
    </form>
  )
}
ImportForm.propTypes = { token: PropTypes.string.isRequired, onImported: PropTypes.func.isRequired }

const Reviews = ({ token }) => {
  const [filters, setFilters] = useState({ status: 'pending', rating: '', source: '', q: '' })
  const [page, setPage] = useState(1)
  const [list, setList] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState('')
  const [showImport, setShowImport] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const { data } = await axios.get(`${backendUrl}/api/review/admin/list`, { headers: { token }, params: buildListParams({ ...filters, page }) })
      setList(data.reviews || [])
      setPagination(data.pagination)
      setError('')
    } catch (err) { setError(message(err, 'Could not load reviews.')) } finally { setLoading(false) }
  }, [token, filters, page])
  useEffect(() => { load() }, [load])

  const update = key => event => { setPage(1); setFilters({ ...filters, [key]: event.target.value }) }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h1 className='text-xl font-semibold text-gray-800'>Customer reviews</h1>
        <button type='button' onClick={() => setShowImport(!showImport)} className='border px-3 py-1 text-sm'>
          {showImport ? 'Close' : 'Add genuine feedback'}
        </button>
      </div>
      {showImport && <ImportForm token={token} onImported={() => { setShowImport(false); load() }} />}

      <div className='flex flex-wrap gap-2 text-sm'>
        <select aria-label='Status' value={filters.status} onChange={update('status')} className='border px-2 py-1'>
          <option value=''>All statuses</option>
          {REVIEW_STATUSES.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
        </select>
        <select aria-label='Rating' value={filters.rating} onChange={update('rating')} className='border px-2 py-1'>
          <option value=''>All ratings</option>
          {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} stars</option>)}
        </select>
        <select aria-label='Origin' value={filters.source} onChange={update('source')} className='border px-2 py-1'>
          <option value=''>All origins</option>
          <option value='customer'>Customer</option>
          <option value='imported'>Manually imported</option>
        </select>
        <input aria-label='Search product or customer' placeholder='Search product or customer' value={filters.q} onChange={update('q')} className='min-w-0 flex-1 border px-2 py-1' />
      </div>

      {error && <p className='text-sm text-red-700' role='alert'>{error}</p>}
      {loading && <p className='text-sm'>Loading…</p>}
      {!loading && !error && list.length === 0 && <p className='text-sm'>No reviews match these filters.</p>}
      <ul className='space-y-2'>
        {list.map(review => (
          <li key={review._id} className='border bg-white'>
            <button type='button' aria-expanded={openId === review._id} onClick={() => setOpenId(openId === review._id ? '' : review._id)}
              className='w-full p-3 text-left text-sm'>
              <span className='font-medium'>{review.productName || review.productId}</span>
              <span className='ml-2 text-amber-700' aria-label={`${review.rating} out of 5 stars`}>{stars(review.rating)}</span>
              <span className='ml-2 rounded bg-gray-100 px-2 py-0.5'>{STATUS_LABELS[review.status]}</span>
              <span className='block text-gray-600'>{review.displayName} · {sourceLabel(review)} · {when(review.createdAt)}</span>
              <span className='block truncate'>{review.title || review.body}</span>
            </button>
            {openId === review._id && <ReviewDetail id={review._id} token={token} onChanged={load} />}
          </li>
        ))}
      </ul>
      {pagination.pages > 1 && (
        <div className='flex items-center justify-between text-sm'>
          <button type='button' disabled={page <= 1} onClick={() => setPage(page - 1)} className='border px-3 py-1 disabled:opacity-40'>Previous</button>
          <span>Page {pagination.page} of {pagination.pages} · {pagination.total} reviews</span>
          <button type='button' disabled={page >= pagination.pages} onClick={() => setPage(page + 1)} className='border px-3 py-1 disabled:opacity-40'>Next</button>
        </div>
      )}
    </div>
  )
}
Reviews.propTypes = { token: PropTypes.string.isRequired }

export default Reviews
