import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { backendUrl, currency } from '../App'
import { toast } from 'react-toastify'
import { statusButtons, statusConfirmMessage, statusLabel } from '../utils/productStatus'
import { availableStock } from '../utils/stockAdjustment'

const List = ({ token }) => {
  const [list, setList] = useState([])
  const [busyId, setBusyId] = useState('')
  const busyRef = useRef(false)

  const fetchList = useCallback(async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/product/admin/list`, { headers: { token } })
      if (response.data.success) setList(response.data.products)
      else toast.error(response.data.message)
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to load products.')
    }
  }, [token])

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

  useEffect(() => { fetchList() }, [fetchList])

  return (
    <section>
      <div className='flex justify-between items-center mb-4'>
        <h1 className='font-medium'>Product catalogue</h1>
        <Link to='/add' className='border px-4 py-2'>Add product</Link>
      </div>
      <div className='flex flex-col gap-2'>
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
    </section>
  )
}

List.propTypes = { token: PropTypes.string.isRequired }

export default List
