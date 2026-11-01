import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { HIGHLIGHT_OPTIONS, applyHighlight, highlightFromProduct } from '../src/utils/productHighlight.js'

test('highlight options are None, Fast Selling and Best Seller', () => {
  assert.deepEqual(HIGHLIGHT_OPTIONS.map(option => option.label), ['None', 'Fast Selling', 'Best Seller'])
})

test('existing products without the new field load as None, and stored badges are recognised', () => {
  assert.equal(highlightFromProduct({}), 'none')
  assert.equal(highlightFromProduct({ bestseller: false }), 'none')
  assert.equal(highlightFromProduct({ bestseller: true }), 'best-seller')
  assert.equal(highlightFromProduct({ fastSelling: true }), 'fast-selling')
})

test('choosing a highlight enables exactly one badge and None clears both', () => {
  const base = { name: 'Saree', bestseller: true, fastSelling: false }
  assert.deepEqual(applyHighlight(base, 'fast-selling'), { name: 'Saree', bestseller: false, fastSelling: true })
  assert.deepEqual(applyHighlight(base, 'best-seller'), { name: 'Saree', bestseller: true, fastSelling: false })
  assert.deepEqual(applyHighlight(base, 'none'), { name: 'Saree', bestseller: false, fastSelling: false })
})

test('the form offers a Product highlights section with no manual Low Stock control', () => {
  const form = readFileSync(new URL('../src/pages/Add.jsx', import.meta.url), 'utf8')
  assert.match(form, /Product highlights/)
  assert.match(form, /Product badge/)
  assert.doesNotMatch(form, /setField\('lowStock'/)
  assert.match(form, /delete payload\.lowStock/)
})
