import test from 'node:test'
import assert from 'node:assert/strict'
import { getProductImage, imagesForVariant } from '../src/utils/productDisplay.js'

const images = [
  { url: 'shared', role: 'primary', order: 0 },
  { url: 'red-2', role: 'other', order: 2, variantSku: 'RED' },
  { url: 'red-1', role: 'other', order: 1, variantSku: 'RED' },
  { url: 'blue', role: 'other', order: 3, variantSku: 'BLUE' }
]

test('selected colour photos come first, then shared photos', () => {
  assert.deepEqual(imagesForVariant(images, 'red').map(i => i.url), ['red-1', 'red-2', 'shared'])
  assert.deepEqual(imagesForVariant(images, 'BLUE').map(i => i.url), ['blue', 'shared'])
})

test('a colour with no photos falls back to shared photos only', () => {
  assert.deepEqual(imagesForVariant(images, 'GREEN').map(i => i.url), ['shared'])
})

test('cart image follows the variant, and legacy products are unchanged', () => {
  assert.equal(getProductImage({ images }, 'BLUE').url, 'blue')
  assert.equal(getProductImage({ images: [{ url: 'p', role: 'primary' }] }, 'ANY').url, 'p')
  assert.equal(getProductImage({ images: [] }, 'ANY'), null)
})

test('product cards (no variant) still get a photo when every image is colour-tagged', () => {
  const tagged = [{ url: 'r', role: 'other', order: 1, variantSku: 'RED' }, { url: 'b', role: 'primary', order: 0, variantSku: 'BLUE' }]
  assert.equal(getProductImage({ images: tagged }).url, 'b')
  assert.equal(getProductImage({ images: tagged }, 'GREEN'), null)
  assert.equal(imagesForVariant(tagged, ' red ')[0].url, 'r')
})
