import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_CATEGORIES as BACKEND_CATEGORIES,
  PRODUCT_TYPES,
  SUBCATEGORIES as BACKEND_SUBCATEGORIES,
  categoryForProductType,
  normalizeCategoryLabel as backendNormalize,
  resolveProductCategory as backendResolve
} from '../../backend/config/catalogueTaxonomy.js'
import {
  CANONICAL_CATEGORIES,
  SUBCATEGORIES,
  normalizeCategoryLabel,
  resolveCategorySlug,
  resolveProductCategory
} from '../src/config/canonicalCategories.js'
import { storefrontCategories } from '../src/config/productCategories.js'
import { buildPageMeta } from '../src/utils/seo.js'

const LABELS = [
  'Sarees', 'saree', 'SAREES', '  Silk   Sarees ', 'cotton sarees', 'Suit Piece', 'suit pieces', 'Suit Pants', 'SUIT  PANTS',
  'Lehenga', 'lehengas', 'Kurti', 'KURTIS', 'Dupatta', 'Lungis', '', 'Sarees!', undefined, null, 7
]

// The backend taxonomy is the source of truth. The frontend cannot import it at deploy time, so these
// tests fail if the two copies drift apart.
test('frontend canonical categories equal the backend taxonomy (id, label, slug, status, order)', () => {
  assert.deepEqual(CANONICAL_CATEGORIES, BACKEND_CATEGORIES)
})

test('storefront category list matches the canonical backend categories (slug, label, order)', () => {
  assert.deepEqual(
    storefrontCategories.map(({ slug, label }) => ({ slug, label })),
    BACKEND_CATEGORIES.map(({ slug, label }) => ({ slug, label }))
  )
})

test('only the canonical available category is always-available on the storefront', () => {
  const available = BACKEND_CATEGORIES.filter(category => category.status === 'available').map(category => category.slug)
  assert.deepEqual(storefrontCategories.filter(category => category.alwaysAvailable).map(category => category.slug), available)
})

test('label normalisation matches the backend for every sample, preserving the raw input', () => {
  for (const raw of LABELS) {
    assert.deepEqual(normalizeCategoryLabel(raw), backendNormalize(raw), String(raw))
  }
})

test('product resolution matches the backend for every productType and label combination', () => {
  for (const productType of [...PRODUCT_TYPES, 'bogus', undefined]) {
    for (const category of LABELS) {
      for (const subCategory of ['', ' Banarasi ', undefined]) {
        const product = { productType, category, subCategory }
        assert.deepEqual(resolveProductCategory(product), backendResolve(product), JSON.stringify(product))
      }
    }
  }
  for (const type of PRODUCT_TYPES) {
    assert.equal(resolveProductCategory({ productType: type }).category?.id ?? null, categoryForProductType(type).category?.id ?? null, type)
  }
})

test('legacy and canonical category slugs resolve to a canonical category without a redirect', () => {
  for (const category of CANONICAL_CATEGORIES) {
    assert.deepEqual(resolveCategorySlug(category.slug), { category, subCategory: null, canonical: true })
  }
  const expected = {
    suits: 'suit-pieces', 'suit-sets': 'suit-pieces', 'suit-piece': 'suit-pieces', 'suit-pants': 'suit-pieces',
    saree: 'sarees', 'silk-sarees': 'sarees', 'Cotton-Sarees': 'sarees', lehenga: 'lehengas', kurti: 'kurtis'
  }
  for (const [slug, id] of Object.entries(expected)) {
    const resolved = resolveCategorySlug(slug)
    assert.equal(resolved.category.id, id, slug)
    assert.equal(resolved.canonical, false, slug)
  }
  assert.equal(resolveCategorySlug('suit-pants').subCategory, 'Suit Pants')
  assert.equal(resolveCategorySlug('silk-sarees').subCategory, 'Silk Sarees')
})

test('slugs without a canonical meaning keep their legacy behaviour', () => {
  for (const slug of ['dresses', 'other', 'silk', 'dupatta', '', undefined, '__proto__', 'constructor']) {
    assert.equal(resolveCategorySlug(slug), null, String(slug))
  }
})

test('category page meta: canonical URL is always the canonical category URL', () => {
  const base = { brandName: 'PSH', description: 'd', siteUrl: 'https://shop.test' }
  for (const [pathname, canonical, title] of [
    ['/category/sarees', '/category/sarees', 'Sarees | PSH'],
    ['/category/suit-pieces', '/category/suit-pieces', 'Suit Pieces | PSH'],
    ['/category/suit-pants', '/category/suit-pieces', 'Suit Pants | PSH'],
    ['/category/suits', '/category/suit-pieces', 'Suits | PSH'],
    ['/category/suit-sets', '/category/suit-pieces', 'Suit sets | PSH'],
    ['/category/silk-sarees', '/category/sarees', 'Silk Sarees | PSH'],
    ['/category/Cotton-Sarees/', '/category/sarees', 'Cotton Sarees | PSH'],
    ['/category/kurti', '/category/kurtis', 'Kurtis | PSH'],
    ['/category/lehenga', '/category/lehengas', 'Lehengas | PSH']
  ]) {
    const meta = buildPageMeta({ ...base, pathname })
    assert.equal(meta.canonicalUrl, `https://shop.test${canonical}`, pathname)
    assert.equal(meta.title, title, pathname)
  }
})

test('category page meta: non-canonical legacy slugs keep self-canonical and other pages are untouched', () => {
  const base = { brandName: 'PSH', description: 'd', siteUrl: 'https://shop.test' }
  assert.equal(buildPageMeta({ ...base, pathname: '/category/dresses' }).canonicalUrl, 'https://shop.test/category/dresses')
  assert.equal(buildPageMeta({ ...base, pathname: '/category/silk' }).canonicalUrl, 'https://shop.test/category/silk')
  assert.equal(buildPageMeta({ ...base, pathname: '/collection' }).canonicalUrl, 'https://shop.test/collection')
  assert.equal(buildPageMeta({ ...base, pathname: '/' }).canonicalUrl, 'https://shop.test/')
})

test('recognised subcategories match the backend taxonomy', () => {
  assert.deepEqual(SUBCATEGORIES, BACKEND_SUBCATEGORIES)
  assert.deepEqual(SUBCATEGORIES.map(item => item.label), ['Silk Sarees', 'Cotton Sarees', 'Suit Pants'])
  for (const raw of LABELS) {
    assert.equal(normalizeCategoryLabel(raw).subCategory, backendNormalize(raw).subCategory, String(raw))
  }
})

test('dress stays unresolved for every label in both resolvers; other keeps alias fallback', () => {
  for (const category of ['Kurti', 'Sarees', 'Suit Pants', 'Lehenga', 'Silk Sarees', '']) {
    for (const impl of [resolveProductCategory, backendResolve]) {
      const resolved = impl({ productType: 'dress', category, subCategory: 'Anarkali' })
      assert.equal(resolved.category, null, `dress/${category}`)
      assert.equal(resolved.status, 'unresolved')
      assert.equal(resolved.rawCategory, category)
    }
  }
  assert.equal(resolveProductCategory({ productType: 'other', category: 'Kurti' }).category.id, 'kurtis')
  const pants = resolveProductCategory({ productType: 'other', category: 'Suit Pants' })
  assert.equal(pants.category.id, 'suit-pieces')
  assert.equal(pants.subCategory, 'Suit Pants')
  for (const type of ['saree', 'suit', 'suit-set', 'suit-piece', 'lehenga', 'kurti']) {
    assert.equal(resolveProductCategory({ productType: type, category: 'Kurti' }).category.id,
      backendResolve({ productType: type, category: 'Kurti' }).category.id)
  }
})
