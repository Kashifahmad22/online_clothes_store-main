import { useRef, useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { toast } from 'react-toastify'
import { backendUrl } from '../App'
import {
  OPERATIONS,
  availableStock,
  buildAdjustment,
  negativeConfirmMessage
} from '../utils/stockAdjustment'

// Stock is only ever changed through the dedicated server endpoint, as a delta applied atomically.
const StockAdjuster = ({ token, productId, variant, onUpdated }) => {
  const [operation, setOperation] = useState('receive')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const apply = async () => {
    if (busyRef.current) return
    const result = buildAdjustment({ operation, quantity, reason })
    if (result.error) {
      toast.error(result.error)
      return
    }
    if (result.negative &&
      !window.confirm(negativeConfirmMessage(variant.sku, result.body.quantity))) return

    busyRef.current = true
    setBusy(true)
    try {
      const response = await axios.patch(
        `${backendUrl}/api/product/${productId}/variants/${variant._id}/stock`,
        result.body,
        { headers: { token } }
      )
      if (!response.data.success) throw new Error(response.data.message)
      onUpdated(response.data.variant)
      setQuantity('')
      setReason('')
      toast.success(`Stock updated for ${variant.sku}.`)
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to update stock.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className='grid gap-2 border border-dashed p-2 w-full max-w-[640px]'>
      <p className='text-sm'>
        On hand: <b>{variant.stockOnHand}</b> · Reserved: <b>{variant.reserved || 0}</b> · Available: <b>{availableStock(variant)}</b>
      </p>
      <div className='flex flex-wrap gap-2 items-end'>
        <label className='grid gap-1 text-sm'>Adjustment
          <select value={operation} onChange={event => setOperation(event.target.value)}
            disabled={busy} className='px-2 py-2'>
            {OPERATIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className='grid gap-1 text-sm'>Quantity
          <input type='number' step='1' value={quantity} disabled={busy}
            onChange={event => setQuantity(event.target.value)}
            className='px-2 py-2 w-28'
            placeholder={operation === 'receive' ? 'e.g. 10' : 'e.g. -2'} />
        </label>
        {operation === 'correction' && (
          <label className='grid gap-1 text-sm'>Reason (required)
            <input value={reason} disabled={busy} maxLength={200}
              onChange={event => setReason(event.target.value)}
              className='px-2 py-2' placeholder='e.g. Damaged piece' />
          </label>
        )}
        <button type='button' onClick={apply} disabled={busy}
          className='border px-3 py-2 disabled:opacity-40'>
          {busy ? 'Updating…' : 'Apply'}
        </button>
      </div>
    </div>
  )
}

StockAdjuster.propTypes = {
  token: PropTypes.string.isRequired,
  productId: PropTypes.string.isRequired,
  variant: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    sku: PropTypes.string.isRequired,
    stockOnHand: PropTypes.number,
    reserved: PropTypes.number
  }).isRequired,
  onUpdated: PropTypes.func.isRequired
}

export default StockAdjuster
