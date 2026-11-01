import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  activeFilterChips, apiParams, clearedFilters, debounce, emptyFilters, filtersToParams,
  hasActiveFilters, parseFilters, withFilter
} from '../src/utils/catalogueFilters.js'
import { merchandisingBadges, priceInfo, stockLines, stockSummaryOf } from '../src/utils/catalogueDisplay.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('filters round-trip through the URL and omit defaults', () => {
  const filters = { ...emptyFilters(), search: 'silk', status: 'published', category: 'Sarees', stock: 'low-stock', badge: 'bestseller', sort: 'price-asc' }
  const params = filtersToParams(filters, 3)
  assert.equal(params.get('page'), '3')
  assert.deepEqual(parseFilters(params), filters)
  assert.equal(filtersToParams(emptyFilters()).toString(), '')
})

test('invalid URL values are ignored', () => {
  const params = new URLSearchParams('status=bogus&stock=x&sort=stock-asc&badge=1&productType=nope')
  assert.deepEqual(parseFilters(params), emptyFilters())
  assert.equal(parseFilters(new URLSearchParams(`search=${'a'.repeat(200)}`)).search.length, 80)
})

test('changing a filter resets to page 1', () => {
  const next = filtersToParams(withFilter(emptyFilters(), 'status', 'draft'), 1)
  assert.equal(next.has('page'), false)
  assert.equal(next.get('status'), 'draft')
})

test('apiParams sends only active filters', () => {
  assert.deepEqual(apiParams(emptyFilters(), 2, 20), { page: 2, limit: 20 })
  const params = apiParams({ ...emptyFilters(), status: 'published', sort: 'name-asc' }, 1, 20)
  assert.deepEqual(params, { page: 1, limit: 20, status: 'published', sort: 'name-asc' })
})

test('chips and clear all keep the sort order', () => {
  const filters = { ...emptyFilters(), search: 'a', stock: 'out-of-stock', sort: 'name-asc' }
  assert.equal(activeFilterChips(filters).length, 2)
  assert.equal(hasActiveFilters(emptyFilters()), false)
  const cleared = clearedFilters(filters)
  assert.equal(hasActiveFilters(cleared), false)
  assert.equal(cleared.sort, 'name-asc')
})

test('debounce collapses rapid calls and can be cancelled', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const run = debounce(value => calls.push(value), 350)
  run('a'); run('ab'); run('abc')
  assert.equal(run.pending(), true)
  t.mock.timers.tick(349)
  assert.deepEqual(calls, [])
  t.mock.timers.tick(1)
  assert.deepEqual(calls, ['abc'])
  run('x'); run.cancel(); t.mock.timers.tick(1000)
  assert.deepEqual(calls, ['abc'])
})

test('badges: merchandising and stock indicators', () => {
  const base = { stockSummary: { availableUnits: 3, activeVariantCount: 1, inactiveVariantCount: 0, state: 'low-stock' } }
  assert.deepEqual(merchandisingBadges({ ...base, bestseller: true, fastSelling: true }).map(b => b.key),
    ['bestseller', 'fastSelling', 'low-stock'])
  const out = { stockSummary: { availableUnits: 0, activeVariantCount: 0, inactiveVariantCount: 1, state: 'out-of-stock' }, bestseller: false }
  assert.deepEqual(merchandisingBadges(out).map(b => b.key), ['out-of-stock'])
})

test('fallback never invents Low Stock for an unavailable product', () => {
  const product = { lowStock: true, variants: [{ active: true, stockOnHand: 2, reserved: 2 }] }
  assert.equal(stockSummaryOf(product).state, 'out-of-stock')
  assert.equal(merchandisingBadges(product).some(b => b.key === 'low-stock'), false)
})

test('stock lines label available stock and variant counts', () => {
  const product = { stockSummary: { availableUnits: 12, activeVariantCount: 2, inactiveVariantCount: 1, state: 'in-stock' } }
  assert.deepEqual(stockLines(product), ['Available stock: 12', '2 active variants', '1 inactive'])
  assert.ok(!stockLines(product).join(' ').toLowerCase().includes('reserved'))
})

test('price info only crosses out a genuinely higher MRP', () => {
  assert.deepEqual(priceInfo({ pricePaise: 150000, mrpPaise: 200000 }), { selling: '1500.00', mrp: '2000.00', mrpIsDiscount: true, isFrom: false })
  assert.equal(priceInfo({ pricePaise: 150000, mrpPaise: 150000 }).mrpIsDiscount, false)
  assert.equal(priceInfo({ pricePaise: 150000 }).mrp, null)
  const from = priceInfo({ pricePaise: 150000, startingPricePaise: 120000, mrpPaise: 200000 })
  assert.deepEqual([from.selling, from.isFrom], ['1200.00', true])
})

test('page wiring: URL state, stale gate, distinct no-results state, no stock editing', () => {
  const list = read('../src/pages/List.jsx')
  assert.match(list, /parseFilters\(searchParams\)/)
  assert.match(list, /filtersToParams\(withFilter\(current, key, value\), 1\)/)
  assert.match(list, /apiParams\(filters, page, PAGE_SIZE\)/)
  assert.match(list, /gate\.isCurrent\(requestId\)/)
  assert.match(list, /data-testid='no-results'/)
  assert.match(list, /No products yet\./)
  assert.doesNotMatch(list, /stockOnHand|adjust/i)
})

test('item and toolbar: actions reachable on every size, 44px targets', () => {
  const item = read('../src/components/CatalogueItem.jsx')
  assert.match(item, /\/add\?id=/)
  assert.match(item, /statusButtons/)
  assert.match(item, /min-h-\[44px\]/)
  const bar = read('../src/components/CatalogueToolbar.jsx')
  assert.match(bar, /Clear all filters/)
  assert.match(bar, /Remove filter/)
  assert.match(bar, /min-h-\[44px\]/)
})
