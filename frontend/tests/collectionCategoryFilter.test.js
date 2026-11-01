import test from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_CATEGORIES } from '../src/config/canonicalCategories.js'
import { categoryFilterOptions, collectionCategoryParams } from '../src/config/productCategories.js'

// Pure-helper tests. Rendered behaviour is covered by collectionRendered.test.js.
test('Collection category filter offers exactly the four canonical choices', () => {
  assert.deepEqual(categoryFilterOptions.map(option => option.value), ['sarees', 'suit-pieces', 'lehengas', 'kurtis'])
  assert.deepEqual(categoryFilterOptions.map(option => option.label), CANONICAL_CATEGORIES.map(category => category.label))
})

test('selecting each category yields the canonical request parameter without a subcategory', () => {
  for (const { id } of CANONICAL_CATEGORIES) {
    const params = collectionCategoryParams({ mode: 'all', categoryParam: id })
    assert.equal(params.canonical.id, id)
    assert.equal(params.subCategory, null)
    assert.equal(params.category, '')
  }
})

test('legacy subcategory labels keep parent and subcategory separate, with consistent normalisation', () => {
  const cases = [
    [' silk  SAREES ', 'sarees', 'Silk Sarees'],
    ['Cotton Sarees', 'sarees', 'Cotton Sarees'],
    ['Suit Pants', 'suit-pieces', 'Suit Pants'],
    ['  suit   PANTS', 'suit-pieces', 'Suit Pants'],
    ['Sarees', 'sarees', null],
    ['Suit Pieces', 'suit-pieces', null]
  ]
  for (const [raw, parent, sub] of cases) {
    const params = collectionCategoryParams({ mode: 'all', categoryParam: raw })
    assert.deepEqual([params.canonical.id, params.subCategory, params.category], [parent, sub, ''], raw)
  }
  const unknown = collectionCategoryParams({ mode: 'all', categoryParam: 'Dupatta' })
  assert.deepEqual([unknown.canonical, unknown.subCategory, unknown.category], [null, null, 'Dupatta'])
  assert.deepEqual(collectionCategoryParams({ mode: 'all' }),
    { canonical: null, subCategory: null, productType: '', category: '' })
})

test('category routes and the query filter resolve identically', () => {
  for (const [slug, label] of [['sarees', 'Sarees'], ['cotton-sarees', 'Cotton Sarees'], ['silk-sarees', 'Silk Sarees'],
    ['suit-pieces', 'Suit Pieces'], ['suit-pants', 'Suit Pants']]) {
    const route = collectionCategoryParams({ mode: 'category', routeCategory: slug })
    const query = collectionCategoryParams({ mode: 'all', categoryParam: label })
    assert.deepEqual([route.canonical.id, route.subCategory], [query.canonical.id, query.subCategory], slug)
  }
  assert.equal(collectionCategoryParams({ mode: 'category', routeCategory: 'kurtis' }).canonical.id, 'kurtis')
  const suits = collectionCategoryParams({ mode: 'category', routeCategory: 'suits' })
  assert.deepEqual([suits.canonical.id, suits.productType, suits.subCategory], ['suit-pieces', 'suit', null])
  const sets = collectionCategoryParams({ mode: 'category', routeCategory: 'suit-sets' })
  assert.deepEqual([sets.canonical.id, sets.productType, sets.subCategory], ['suit-pieces', 'suit-set', null])
  assert.equal(collectionCategoryParams({ mode: 'category', routeCategory: 'suit-pieces' }).productType, '')
  assert.equal(collectionCategoryParams({ mode: 'all', productTypeParam: 'saree' }).productType, 'saree')
})
