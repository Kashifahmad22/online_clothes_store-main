import PropTypes from 'prop-types'

// Buttons step a whole-number quantity between 1 and `max`; typing is still validated by the page.
const QuantitySelector = ({ value, max, onChange, error = '', note = '' }) => {
  const numeric = /^\d+$/.test(String(value).trim()) ? Number(value) : 0
  const atMax = max < 1 || numeric >= max
  const atMin = numeric <= 1
  const step = delta => onChange(String(Math.min(Math.max(max, 1), Math.max(1, numeric + delta))))
  const buttonClass = 'quantity-step flex h-11 w-11 items-center justify-center border border-stone-300 bg-white text-lg disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className='quantity-selector'>
      <div className='flex items-center gap-3 text-sm font-medium text-stone-900'>
        <span id='product-quantity-label'>Quantity</span>
        <div className='flex items-center' role='group' aria-labelledby='product-quantity-label'>
          <button type='button' className={buttonClass} aria-label='Decrease quantity' disabled={max < 1 || atMin} onClick={() => step(-1)}>−</button>
          <input type='text' inputMode='numeric' pattern='[0-9]*' autoComplete='off' aria-label='Quantity'
            value={value} disabled={max < 1}
            aria-invalid={Boolean(error)}
            aria-describedby='product-quantity-note'
            className='h-11 w-16 border-y border-stone-300 bg-white px-1 text-center disabled:opacity-50'
            onChange={event => onChange(event.target.value)} />
          <button type='button' className={buttonClass} aria-label='Increase quantity' disabled={atMax} onClick={() => step(1)}>+</button>
        </div>
      </div>
      <p id='product-quantity-note' role={error ? 'alert' : undefined}
        className={`mt-1 text-xs ${error ? 'text-red-800' : 'text-stone-600'}`}>
        {error || note}
      </p>
    </div>
  )
}

QuantitySelector.propTypes = {
  value: PropTypes.string.isRequired,
  max: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  error: PropTypes.string,
  note: PropTypes.string
}

export default QuantitySelector
