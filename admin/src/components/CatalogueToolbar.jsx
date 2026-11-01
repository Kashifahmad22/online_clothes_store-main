import { useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import {
  BADGE_OPTIONS, MAX_SEARCH_LENGTH, SORT_OPTIONS, STATUS_OPTIONS, STOCK_OPTIONS, TYPE_OPTIONS,
  activeFilterChips, debounce
} from '../utils/catalogueFilters'

export const SEARCH_DEBOUNCE_MS = 350

const controlClass = 'min-h-[44px] w-full border bg-white px-3 py-2 text-sm'

const Select = ({ label, value, onChange, options, placeholder }) => (
  <label className='grid gap-1 text-xs text-gray-600'>{label}
    <select value={value} onChange={event => onChange(event.target.value)} className={controlClass}>
      <option value=''>{placeholder}</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
)
Select.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })).isRequired,
  placeholder: PropTypes.string.isRequired
}

const CatalogueToolbar = ({ filters, categories, onChange, onClear }) => {
  const [searchInput, setSearchInput] = useState(filters.search)

  // Typing is committed to the URL after a pause. External changes (Back/Forward, Clear all) win.
  useEffect(() => {
    setSearchInput(current => (current.trim() === filters.search ? current : filters.search))
  }, [filters.search])

  const commitSearch = useMemo(
    () => debounce(value => onChange('search', value.trim()), SEARCH_DEBOUNCE_MS),
    [onChange]
  )
  useEffect(() => () => commitSearch.cancel(), [commitSearch])

  const onSearchInput = event => {
    setSearchInput(event.target.value)
    commitSearch(event.target.value)
  }

  const categoryOptions = useMemo(() => {
    const names = new Set(categories)
    if (filters.category) names.add(filters.category)
    return [...names].sort((a, b) => a.localeCompare(b)).map(name => ({ value: name, label: name }))
  }, [categories, filters.category])

  const chips = activeFilterChips(filters)

  return (
    <div className='mb-4 grid gap-3' role='search' aria-label='Filter products'>
      <label className='grid gap-1 text-xs text-gray-600'>Search products
        <input type='search' value={searchInput} onChange={onSearchInput} maxLength={MAX_SEARCH_LENGTH}
          placeholder='Name, SKU, category or type' className={controlClass} />
      </label>
      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3'>
        <Select label='Status' value={filters.status} onChange={value => onChange('status', value)}
          options={STATUS_OPTIONS} placeholder='All statuses' />
        <Select label='Category' value={filters.category} onChange={value => onChange('category', value)}
          options={categoryOptions} placeholder='All categories' />
        <Select label='Product type' value={filters.productType} onChange={value => onChange('productType', value)}
          options={TYPE_OPTIONS} placeholder='All types' />
        <Select label='Stock' value={filters.stock} onChange={value => onChange('stock', value)}
          options={STOCK_OPTIONS} placeholder='Any stock level' />
        <Select label='Merchandising' value={filters.badge} onChange={value => onChange('badge', value)}
          options={BADGE_OPTIONS} placeholder='Any badge' />
        <label className='grid gap-1 text-xs text-gray-600'>Sort by
          <select value={filters.sort} onChange={event => onChange('sort', event.target.value)} className={controlClass}>
            {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      {chips.length > 0 && (
        <div className='flex flex-wrap items-center gap-2' data-testid='active-filters'>
          <span className='text-xs text-gray-600'>Active filters:</span>
          {chips.map(chip => (
            <button key={chip.key} type='button' onClick={() => onChange(chip.key, '')}
              aria-label={`Remove filter ${chip.label}`}
              className='inline-flex min-h-[44px] max-w-full items-center gap-2 border bg-white px-3 text-xs'>
              <span className='break-words text-left'>{chip.label}</span><span aria-hidden='true'>×</span>
            </button>
          ))}
          <button type='button' onClick={onClear} className='min-h-[44px] px-3 text-xs underline'>Clear all filters</button>
        </div>
      )}
    </div>
  )
}

CatalogueToolbar.propTypes = {
  filters: PropTypes.object.isRequired,
  categories: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired
}

export default CatalogueToolbar
