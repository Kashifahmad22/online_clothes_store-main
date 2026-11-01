import test from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCT_TYPES } from '../../backend/config/catalogueTaxonomy.js'
import { TYPE_OPTIONS } from '../src/utils/catalogueFilters.js'
import { productTypeLabel } from '../src/utils/catalogueDisplay.js'

test('admin product type options and labels cover every backend product type', () => {
  assert.deepEqual(new Set(TYPE_OPTIONS.map(option => option.value)), new Set(PRODUCT_TYPES))
  for (const type of PRODUCT_TYPES) assert.notEqual(productTypeLabel(type), type, `${type} has a label`)
  assert.equal(productTypeLabel('kurti'), 'Kurti')
})
