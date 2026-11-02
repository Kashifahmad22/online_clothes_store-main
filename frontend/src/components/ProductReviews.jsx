import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import axios from 'axios'
import { Link, useLocation } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'
import { RatingStars } from './RatingBadge'
import { ratingLabel } from '../utils/ratings'

const MAX_PHOTOS = 4
const MAX_BYTES = 5 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PAGE_SIZE = 5
const formatDate = value => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
const apiError = (error, fallback) => error?.response?.data?.message || fallback

const Distribution = ({ summary }) => (
  <ul className='space-y-1' aria-label='Rating breakdown'>
    {[5, 4, 3, 2, 1].map(star => {
      const n = summary.distribution?.[star - 1] || 0
      const pct = summary.count ? Math.round(n / summary.count * 100) : 0
      return (
        <li key={star} className='flex items-center gap-2 text-xs text-stone-700'>
          <span className='w-10 shrink-0'>{star} star</span>
          <span className='h-2 flex-1 overflow-hidden rounded bg-stone-200' aria-hidden='true'>
            <span className='block h-full bg-amber-700' style={{ width: `${pct}%` }} />
          </span>
          <span className='w-8 shrink-0 text-right'>{n}</span>
        </li>
      )
    })}
  </ul>
)
Distribution.propTypes = { summary: PropTypes.object.isRequired }

const ReviewForm = ({ productId, onSubmitted }) => {
  const { backendUrl, token } = useContext(ShopContext)
  const location = useLocation()
  const [rating, setRating] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [state, setState] = useState({ status: 'idle', message: '' })
  const [mine, setMine] = useState(null)
  const fileInput = useRef(null)

  useEffect(() => {
    if (!token) { setMine(null); return undefined }
    let active = true
    axios.get(`${backendUrl}/api/review/mine/${productId}`, { headers: { token } })
      .then(({ data }) => { if (active && data.success) setMine(data) })
      .catch(() => {})
    return () => { active = false }
  }, [backendUrl, token, productId, state.status])

  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file))
    setPreviews(urls)
    return () => urls.forEach(url => URL.revokeObjectURL(url))
  }, [files])

  if (!token) {
    return (
      <p className='text-sm text-stone-700'>
        <Link to='/login' state={{ from: location.pathname }} className='font-semibold text-rose-950 underline'>Log in</Link> to write a review.
      </p>
    )
  }
  if (mine?.review) {
    const label = { pending: 'is awaiting approval', approved: 'is published', rejected: 'was not published', hidden: 'is not currently shown', flagged: 'is being checked' }[mine.review.status] || 'was received'
    return <p className='text-sm text-stone-700' role='status'>Thanks — your review {label}.</p>
  }

  const pickFiles = event => {
    const picked = Array.from(event.target.files || [])
    event.target.value = ''
    const next = [...files, ...picked]
    if (next.length > MAX_PHOTOS) return setState({ status: 'error', message: `You can add up to ${MAX_PHOTOS} photos.` })
    const bad = picked.find(file => !TYPES.includes(file.type) || file.size > MAX_BYTES)
    if (bad) return setState({ status: 'error', message: 'Photos must be JPG, PNG or WebP and 5 MB or smaller.' })
    setState({ status: 'idle', message: '' })
    return setFiles(next)
  }

  const submit = async event => {
    event.preventDefault()
    if (state.status === 'saving') return
    if (!rating) return setState({ status: 'error', message: 'Choose a star rating.' })
    if (!body.trim()) return setState({ status: 'error', message: 'Please write a few words about the product.' })
    setState({ status: 'saving', message: '' })
    const form = new FormData()
    form.append('rating', String(rating))
    form.append('title', title)
    form.append('body', body)
    files.forEach(file => form.append('images', file))
    try {
      const { data } = await axios.post(`${backendUrl}/api/review/product/${productId}`, form, { headers: { token } })
      setState({ status: 'done', message: data.message })
      onSubmitted?.()
    } catch (error) {
      setState({ status: 'error', message: apiError(error, 'Could not save your review. Please try again.') })
    }
  }

  if (state.status === 'done') return <p className='text-sm font-medium text-emerald-800' role='status'>{state.message}</p>

  return (
    <form onSubmit={submit} className='space-y-3' noValidate aria-label='Write a review'>
      <fieldset>
        <legend className='text-sm font-medium text-stone-900'>Your rating</legend>
        <div className='mt-1 flex gap-1' role='radiogroup' aria-label='Star rating'>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type='button' role='radio' aria-checked={rating === n} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
              onClick={() => setRating(n)}
              className={`h-11 w-11 rounded border text-xl ${rating >= n ? 'border-amber-700 text-amber-700' : 'border-stone-300 text-stone-400'}`}>
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <label className='block text-sm font-medium text-stone-900'>Title (optional)
        <input value={title} maxLength={100} onChange={e => setTitle(e.target.value)} className='mt-1 w-full border border-stone-300 px-3 py-2 text-sm font-normal' />
      </label>
      <label className='block text-sm font-medium text-stone-900'>Your review
        <textarea value={body} maxLength={2000} rows={4} onChange={e => setBody(e.target.value)} className='mt-1 w-full border border-stone-300 px-3 py-2 text-sm font-normal' />
      </label>
      <div>
        <input ref={fileInput} type='file' accept='image/jpeg,image/png,image/webp' multiple onChange={pickFiles} className='sr-only' id='review-photos' />
        <button type='button' onClick={() => fileInput.current?.click()} disabled={files.length >= MAX_PHOTOS}
          className='min-h-11 border border-stone-400 px-3 text-sm disabled:opacity-50'>
          Add photos ({files.length}/{MAX_PHOTOS})
        </button>
        {previews.length > 0 && (
          <ul className='mt-2 flex flex-wrap gap-2'>
            {previews.map((src, index) => (
              <li key={src} className='relative'>
                <img src={src} alt={`Selected photo ${index + 1}`} className='h-16 w-16 rounded object-cover' />
                <button type='button' aria-label={`Remove photo ${index + 1}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}
                  className='absolute -right-2 -top-2 h-6 w-6 rounded-full bg-rose-950 text-xs text-white'>×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {state.status === 'error' && <p className='text-sm text-red-700' role='alert'>{state.message}</p>}
      <button type='submit' disabled={state.status === 'saving'} className='min-h-11 bg-rose-950 px-5 text-sm font-semibold uppercase text-white disabled:bg-stone-400'>
        {state.status === 'saving' ? 'Submitting…' : 'Submit review'}
      </button>
      <p className='text-xs text-stone-600'>Reviews are checked before they appear.</p>
    </form>
  )
}
ReviewForm.propTypes = { productId: PropTypes.string.isRequired, onSubmitted: PropTypes.func }

const ProductReviews = ({ productId }) => {
  const { backendUrl } = useContext(ShopContext)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (target, signal) => {
    setLoading(true)
    try {
      const { data: result } = await axios.get(`${backendUrl}/api/review/product/${productId}`, { params: { page: target, limit: PAGE_SIZE }, signal })
      setData(result)
      setError('')
    } catch (err) {
      if (!axios.isCancel(err)) setError('Reviews could not be loaded right now.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [backendUrl, productId])

  useEffect(() => {
    const controller = new AbortController()
    load(page, controller.signal)
    return () => controller.abort()
  }, [load, page])

  const summary = data?.summary
  const reviews = data?.reviews || []
  const pages = data?.pagination?.pages || 1

  return (
    <section className='mx-auto mt-10 max-w-7xl px-4 sm:px-6' aria-labelledby='reviews-heading'>
      <h2 id='reviews-heading' className='text-xl font-semibold text-rose-950'>Customer reviews</h2>
      {error && <p className='mt-3 text-sm text-red-700' role='alert'>{error}</p>}
      {!error && loading && !data && <p className='mt-3 text-sm text-stone-600' role='status'>Loading reviews…</p>}

      {summary && summary.count > 0 && (
        <div className='mt-4 grid gap-4 sm:grid-cols-[12rem_1fr] sm:items-center'>
          <div>
            <p className='text-3xl font-semibold text-stone-900'>{summary.average.toFixed(1)}<span className='text-base font-normal text-stone-600'> / 5</span></p>
            <RatingStars value={summary.average} label={ratingLabel(summary.average, summary.count)} />
            <p className='text-sm text-stone-600'>{summary.count} {summary.count === 1 ? 'review' : 'reviews'}</p>
          </div>
          <Distribution summary={summary} />
        </div>
      )}
      {summary && summary.count === 0 && !error && (
        <p className='mt-3 text-sm text-stone-700'>No reviews yet. Be the first to share your experience.</p>
      )}

      {reviews.length > 0 && (
        <ul className='mt-5 divide-y divide-stone-200 border-y border-stone-200'>
          {reviews.map(review => (
            <li key={review._id} className='py-4'>
              <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                <RatingStars value={review.rating} label={`${review.rating} out of 5 stars`} />
                {review.title && <h3 className='text-sm font-semibold text-stone-900'>{review.title}</h3>}
              </div>
              <p className='mt-1 flex flex-wrap items-center gap-x-2 text-xs text-stone-600'>
                <span>{review.displayName}</span>
                <span aria-hidden='true'>·</span>
                <time dateTime={new Date(review.date).toISOString?.() || ''}>{formatDate(review.date)}</time>
                {review.verifiedPurchase && <span className='rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800'>Verified purchase</span>}
              </p>
              <p className='mt-2 whitespace-pre-line break-words text-sm text-stone-800'>{review.body}</p>
              {review.images.length > 0 && (
                <ul className='mt-3 flex flex-wrap gap-2'>
                  {review.images.map((image, index) => (
                    <li key={image.url}>
                      <a href={image.url} target='_blank' rel='noopener noreferrer' aria-label={`Open customer photo ${index + 1} from ${review.displayName}'s review`}>
                        <img src={image.url} alt={`Customer photo ${index + 1} from ${review.displayName}'s review`} loading='lazy' className='h-20 w-20 rounded object-cover' />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className='mt-4 flex items-center justify-between text-sm' aria-label='Review pages'>
          <button type='button' disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className='min-h-11 border border-stone-300 px-4 disabled:opacity-40'>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type='button' disabled={page >= pages || loading} onClick={() => setPage(page + 1)} className='min-h-11 border border-stone-300 px-4 disabled:opacity-40'>Next</button>
        </nav>
      )}

      <div className='mt-6 border border-stone-200 p-4'>
        <h3 className='mb-3 text-base font-semibold text-stone-900'>Write a review</h3>
        <ReviewForm productId={productId} />
      </div>
    </section>
  )
}
ProductReviews.propTypes = { productId: PropTypes.string.isRequired }

export default ProductReviews
