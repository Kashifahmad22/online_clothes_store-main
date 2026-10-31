import axios from 'axios'
import { useCallback, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { backendUrl, currency } from '../App'
import { toast } from 'react-toastify'

const List = ({ token }) => {
  const [list, setList] = useState([])

  const fetchList = useCallback(async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/product/admin/list`, { headers: { token } })
      if (response.data.success) setList(response.data.products)
      else toast.error(response.data.message)
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to load products.')
    }
  }, [token])

  const updateStatus = async (product, status) => {
    try {
      const response = await axios.patch(
        `${backendUrl}/api/product/${product._id}/status`,
        { status },
        { headers: { token } }
      )
      if (!response.data.success) throw new Error(response.data.message)
      toast.success(`Product ${status}.`)
      await fetchList()
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to update product.')
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
                <p key={variant._id}>{variant.sku}: {variant.stockOnHand - variant.reserved} available</p>
              ))}
            </div>
            <div className='flex flex-col gap-1'>
              <span>{product.status}</span>
              <button onClick={() => updateStatus(
                product,
                product.status === 'published' ? 'draft' : 'published'
              )} className='underline text-left text-xs'>
                {product.status === 'published' ? 'Unpublish' : 'Publish'}
              </button>
              {product.status !== 'archived' && (
                <button onClick={() => updateStatus(product, 'archived')} className='underline text-left text-xs'>
                  Archive
                </button>
              )}
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
