import axios from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Link, useSearchParams } from 'react-router-dom'
import { backendUrl, currency } from '../App'
import { toast } from 'react-toastify'
import { statusConfirmMessage, statusLabel } from '../utils/productStatus'
import { PAGE_SIZE, correctedPage, createLatestGate, loadErrorMessage, pageSummary, parsePageParam } from '../utils/catalogueList'
import { apiParams, clearedFilters, filtersToParams, hasActiveFilters, parseFilters, withFilter } from '../utils/catalogueFilters'
import CatalogueToolbar from '../components/CatalogueToolbar'
import CatalogueItem, { ITEM_GRID } from '../components/CatalogueItem'

const List = ({ token }) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parsePageParam(searchParams.get('page'))
  const filterKey = searchParams.toString()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => parseFilters(searchParams), [filterKey])
  const [list, setList] = useState([])
  const [pagination, setPagination] = useState(null)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState('')
  const busyRef = useRef(false)
  const gate = useMemo(() => createLatestGate(), [])
  const controllerRef = useRef(null)

  // The toolbar calls these from a debounced timer, so they read the latest state through a ref and
  // keep a stable identity; otherwise a URL change would cancel a search the admin is still typing.
  const latest = useRef({})
  latest.current = { filters, setSearchParams }
  const changeFilter = useCallback((key, value) => {
    const { filters: current, setSearchParams: navigate } = latest.current
    if (current[key] === value) return
    navigate(filtersToParams(withFilter(current, key, value), 1))
  }, [])
  const clearFilters = useCallback(() => {
    const { filters: current, setSearchParams: navigate } = latest.current
    navigate(filtersToParams(clearedFilters(current), 1))
  }, [])

  const goToPage = useCallback((target, replace = false) => {
    setSearchParams(filtersToParams(filters, target), { replace })
  }, [filters, setSearchParams])

  useEffect(() => {
    const controller = new AbortController()
    axios.get(`${backendUrl}/api/product/admin/categories`, { headers: { token }, signal: controller.signal })
      .then(({ data }) => { if (data.success && Array.isArray(data.categories)) setCategories(data.categories) })
      .catch(() => {})
    return () => controller.abort()
  }, [token])

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
        params: apiParams(filters, page, PAGE_SIZE),
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
  }, [token, page, filters, gate, goToPage])

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
  const filtered = hasActiveFilters(filters)

  return (
    <section>
      <div className='flex justify-between items-center mb-4'>
        <h1 className='font-medium'>Product catalogue</h1>
        <Link to='/add' className='inline-flex min-h-[44px] items-center border px-4'>Add product</Link>
      </div>
      <CatalogueToolbar filters={filters} categories={categories} onChange={changeFilter} onClear={clearFilters} />
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
        {list.length > 0 && (
          <div className={`hidden md:grid ${ITEM_GRID} items-center gap-x-3 border bg-gray-100 p-3 text-sm`}>
            <b>Image</b><b>Product</b><b>Type</b><b>Price</b><b>Stock</b>
          </div>
        )}
        {list.map(product => (
          <CatalogueItem key={product._id} product={product} currency={currency}
            busy={busyId === product._id} onStatus={updateStatus} />
        ))}
        {list.length === 0 && filtered && (
          <div className='border bg-white p-4 text-sm' data-testid='no-results'>
            <p className='text-gray-700'>No products match your search or filters.</p>
            <button type='button' onClick={clearFilters} className='mt-2 min-h-[44px] border px-4'>Clear all filters</button>
          </div>
        )}
        {list.length === 0 && !filtered && <p className='py-6 text-gray-500'>No products yet.</p>}
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
