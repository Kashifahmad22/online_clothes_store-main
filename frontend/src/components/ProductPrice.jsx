import PropTypes from 'prop-types'

const ProductPrice = ({ price, mrp, compact = false, from = false }) => {
  const hasDiscount = !from && Number.isFinite(price) && Number.isFinite(mrp) && mrp > price
  const discountPercent = hasDiscount
    ? ((mrp - price) / mrp * 100).toLocaleString('en-IN', { maximumFractionDigits: 1 })
    : '0'

  if (!Number.isFinite(price)) return <p className='text-sm text-stone-600'>Price unavailable</p>

  return (
    <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
      <span className={`${compact ? 'text-base' : 'text-2xl'} font-semibold text-rose-950`}>
        {from && <span className='product-price__from'>From </span>}₹{price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </span>
      {hasDiscount && (
        <>
          <span className='text-sm text-stone-500 line-through'>
            ₹{mrp.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>
          <span className='text-xs font-semibold text-emerald-800'>{discountPercent}% off</span>
        </>
      )}
    </div>
  )
}

ProductPrice.propTypes = {
  price: PropTypes.number,
  mrp: PropTypes.number,
  compact: PropTypes.bool,
  from: PropTypes.bool
}

export default ProductPrice
