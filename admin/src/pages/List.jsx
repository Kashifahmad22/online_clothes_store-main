import axios from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Link, useSearchParams } from 'react-router-dom'
import { backendUrl, currency } from '../App'
import { toast } from 'react-toastify'
import { statusButtons, statusConfirmMessage, statusLabel } from '../utils/productStatus'
import { availableStock } from '../utils/stockAdjustment'
import { PAGE_SIZE, correctedPage, createLatestGate, loadErrorMessage, pageSummary, parsePageParam } from '../utils/catalogueList'

const List = ({ token }) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parsePageParam(searchParams.get('page'))
  const [list, setList] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState('')
  const busyRef = useRef(false)
  const gate = useMemo(() => createLatestGate(), [])
  const controllerRef = useRef(null)

  const goToPage = useCallback((target, replace = false) => {
    const next = new URLSearchParams(searchParams)
    if (target <= 1) next.delete('page')
    else next.set('page', String(target))
    setSearchParams(next, { replace })
  }, [searchParams, setSearchParams])

  const fetchList = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const requestId = gate.next()
    setLoading(true)
    setLoadError('')
    try {
      const response = await axios.get(`${backendUrl}/api/product/admin/list`, {
        headers: { token },
        params: { page, limit: PAGE_SIZE },
        signal: controller.signal
      })
      if (!gate.isCurrent(requestId)) return
      if (!response.data.success || !Array.isArray(response.data.products) || !response.data.pagination) {
        throw new Error(response.data.message || 'The server returned an unexpected response.')
      }
      const fix = correctedPage({ page, totalPages: response.data.pagination.totalPages })
      if (fix !== null) {
        goToPage(fix, true)
        return
      }
      setList(response.data.products)
      setPagination(response.data.pagination)
      setLoading(false)
    } catch (error) {
      if (!gate.isCurrent(requestId) || axios.isCancel(error)) return
      setList([])
      setPagination(null)
      setLoadError(loadErrorMessage(error))
      setLoading(false)
    }
  }, [token, page, gate, goToPage])

  const updateStatus = async (product, button) => {
    if (busyRef.current) return
    if (button.confirm && !window.confirm(statusConfirmMessage(button.action, product.name))) return
    busyRef.current = true
    setBusyId(product._id)
    try {
      const response = await axios.patch(
        `${backendUrl}/api/product/${product._id}/status`,
        { status: button.action },
        { headers: { token } }
      )
      if (!response.data.success) throw new Error(response.data.message)
      toast.success(`Product moved to ${statusLabel(button.action)}.`)
      await fetchList()
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to update product.')
    } finally {
      busyRef.current = false
      setBusyId('')
    }
  }

  useEffect(() => {
    fetchList()
    return () => { controllerRef.current?.abort(); gate.invalidate() }
  }, [fetchList, gate])

  const summary = pagination ? pageSummary(pagination) : null
  const showTable = !loadError && summary

  return (
    <section>
      <div className='flex justify-between items-center mb-4'>
        <h1 className='font-medium'>Product catalogue</h1>
        <Link to='/add' className='border px-4 py-2'>Add product</Link>
      </div>
      {loading && !summary && !loadError && <p role='status' className='py-6 text-gray-500'>Loading products…</p>}
      {loadError && (
        <div role='alert' className='border border-red-300 bg-red-50 p-4 text-sm'>
          <p className='text-red-700'>{loadError}</p>
          <button type='button' onClick={fetchList} disabled={loading}
            className='mt-3 border px-4 py-2 disabled:opacity-40'>
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
      {showTable && (
      <div className={`flex flex-col gap-2 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        <div className='hidden md:grid grid-cols-[0.7fr_2fr_1fr_0.8fr_1.2fr_1fr] items-center py-2 px-2 border bg-gray-100 text-sm'>
          <b>Image</b><b>Product</b><b>Type</b><b>Price</b><b>SKU / Stock</b><b>Status</b>
        </div>
        {list.map(product => (
          <div key={product._id} className='grid grid-cols-[0.7fr_2fr_1fr] md:grid-cols-[0.7fr_2fr_1fr_0.8fr_1.2fr_1fr] items-center gap-2 py-2 px-2 border text-sm'>
            <img className='w-12 h-14 object-cover' src={product.images?.[0]?.url} alt='' />
            <div>
              <p>{product.name}</p>
              {product.collections?.length > 0 && (
                <p className='mt-1 text-xs text-gray-500'>Collections: {product.collections.join(', ')}</p>
              )}
              <Link to={`/add?id=${product._id}`} className='underline text-xs'>Edit product</Link>
            </div>
            <p>{product.productType}</p>
            <p>{currency}{(product.pricePaise / 100).toFixed(2)}</p>
            <div className='text-xs'>
              {product.variants?.map(variant => (
                <p key={variant._id}>{variant.sku}{variant.active === false ? ' (inactive)' : ''}: {availableStock(variant)} available</p>
              ))}
            </div>
            <div className='flex flex-col gap-1'>
              <span>{statusLabel(product.status)}</span>
              {statusButtons(product.status).map(button => (
                <button key={button.action} type='button' disabled={busyId === product._id}
                  onClick={() => updateStatus(product, button)}
                  className='underline text-left text-xs disabled:opacity-40'>
                  {busyId === product._id ? 'Working…' : button.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {list.length === 0 && <p className='py-6 text-gray-500'>No products yet.</p>}
      </div>
      )}
      {showTable && (
        <nav aria-label='Catalogue pagination' className='mt-4 flex flex-wrap items-center justify-between gap-3 text-sm'>
          <p>
            {summary.totalProducts === 0
              ? '0 products'
              : `Showing ${summary.from}–${summary.to} of ${summary.totalProducts} products · Page ${summary.page} of ${summary.totalPages}`}
          </p>
          <div className='flex gap-2'>
            <button type='button' onClick={() => goToPage(page - 1)}
              disabled={loading || !summary.hasPrevious}
              className='border px-4 py-2 min-h-[44px] disabled:opacity-40'>Previous</button>
            <button type='button' onClick={() => goToPage(page + 1)}
              disabled={loading || !summary.hasNext}
              className='border px-4 py-2 min-h-[44px] disabled:opacity-40'>Next</button>
          </div>
        </nav>
      )}
    </section>
  )
}

List.propTypes = { token: PropTypes.string.isRequired }

export default List
