import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { statusButtons, statusLabel } from '../utils/productStatus'
import { merchandisingBadges, priceInfo, productTypeLabel, stockLines } from '../utils/catalogueDisplay'

export const ITEM_GRID =
  'grid-cols-[56px_minmax(0,1fr)] md:grid-cols-[56px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)]'

const TONES = {
  gold: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  red: 'bg-red-100 text-red-800 border-red-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  gray: 'bg-gray-200 text-gray-700 border-gray-300',
  green: 'bg-green-100 text-green-800 border-green-300',
  slate: 'bg-slate-100 text-slate-700 border-slate-300'
}
const STATUS_TONE = { published: 'green', draft: 'slate', archived: 'gray' }

const Pill = ({ tone, children }) => (
  <span className={`inline-block border px-2 py-0.5 text-xs leading-tight ${TONES[tone]}`}>{children}</span>
)
Pill.propTypes = { tone: PropTypes.string.isRequired, children: PropTypes.node.isRequired }

// One markup, two layouts: a stacked card below md and a table-style row from md up.
const CatalogueItem = ({ product, currency, busy, onStatus }) => {
  const price = priceInfo(product)
  const badges = merchandisingBadges(product)
  return (
    <article data-testid='catalogue-item' className={`grid ${ITEM_GRID} items-start gap-x-3 gap-y-2 border bg-white p-3 text-sm`}>
      <img className='h-16 w-14 object-cover md:h-14 md:w-12' src={product.images?.[0]?.url} alt='' />
      <div className='min-w-0'>
        <p className='break-words font-medium text-gray-800'>{product.name}</p>
        <p className='mt-0.5 break-words text-xs text-gray-500'>{product.category}</p>
        {badges.length > 0 && (
          <div className='mt-1 flex flex-wrap gap-1' data-testid='badges'>
            {badges.map(badge => <Pill key={badge.key} tone={badge.tone}>{badge.label}</Pill>)}
          </div>
        )}
        {product.collections?.length > 0 && (
          <p className='mt-1 break-words text-xs text-gray-500'>Collections: {product.collections.join(', ')}</p>
        )}
      </div>
      <p className='col-span-2 md:col-span-1'>
        <span className='text-xs text-gray-500 md:hidden'>Type: </span>{productTypeLabel(product.productType)}
      </p>
      <div className='col-span-2 md:col-span-1' data-testid='price'>
        <span className='font-medium'>{price.isFrom ? 'From ' : ''}{currency}{price.selling}</span>
        {price.mrp !== null && (
          <span className={`ml-2 text-xs text-gray-500 ${price.mrpIsDiscount ? 'line-through' : ''}`}>
            MRP {currency}{price.mrp}
          </span>
        )}
      </div>
      <div className='col-span-2 text-xs md:col-span-1' data-testid='stock'>
        {stockLines(product).map(line => <p key={line}>{line}</p>)}
      </div>
      <div className='col-span-2 flex flex-wrap items-center gap-2 md:col-span-5'>
        <Pill tone={STATUS_TONE[product.status] || 'slate'}>{statusLabel(product.status)}</Pill>
        <Link to={`/add?id=${product._id}`}
          className='inline-flex min-h-[44px] items-center border px-3 underline'>Edit product</Link>
        {statusButtons(product.status).map(button => (
          <button key={button.action} type='button' disabled={busy}
            onClick={() => onStatus(product, button)}
            className='min-h-[44px] border px-3 underline disabled:opacity-40'>
            {busy ? 'Working…' : button.label}
          </button>
        ))}
      </div>
    </article>
  )
}

CatalogueItem.propTypes = {
  product: PropTypes.object.isRequired,
  currency: PropTypes.string.isRequired,
  busy: PropTypes.bool.isRequired,
  onStatus: PropTypes.func.isRequired
}

export default CatalogueItem
