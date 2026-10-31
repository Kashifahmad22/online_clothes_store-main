import assert from 'node:assert/strict'
import test from 'node:test'
import { cloudinaryUrl, resizedSrcSet, resizedUrl, socialImageUrl } from '../src/utils/images.js'
import {
  applyPageMeta, buildPageMeta, buildProductJsonLd, buildProductMeta, normaliseSiteUrl, setJsonLd
} from '../src/utils/seo.js'

const SITE = 'https://shop.example.com'
const IMG = 'https://res.cloudinary.com/demo/image/upload/v123/saree.jpg'

// Minimal DOM double covering the head operations used by the SEO helpers.
const fakeDocument = () => {
  const nodes = []
  const make = tagName => {
    const attrs = {}
    const node = {
      tagName, attrs, textContent: '', id: '', type: '',
      setAttribute: (key, value) => { attrs[key] = value },
      getAttribute: key => attrs[key],
      remove: () => { nodes.splice(nodes.indexOf(node), 1) }
    }
    return node
  }
  const matches = (node, selector) => {
    const tag = selector.match(/^[a-z]+/)[0]
    const [, key, value] = selector.match(/\[([^=]+)="([^"]+)"\]/)
    return node.tagName.toLowerCase() === tag && node.attrs[key] === value
  }
  return {
    title: '',
    nodes,
    createElement: tag => make(tag.toUpperCase()),
    getElementById: id => nodes.find(node => node.id === id) || null,
    head: {
      appendChild: node => nodes.push(node),
      querySelector: selector => nodes.find(node => matches(node, selector)) || null
    }
  }
}
const metaContent = (doc, attribute, key) =>
  doc.nodes.find(node => node.tagName === 'META' && node.attrs[attribute] === key)?.attrs.content

test('cloudinary transformations apply only to untransformed Cloudinary uploads', () => {
  assert.equal(resizedUrl(IMG, 480), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_480,c_limit/v123/saree.jpg')
  assert.equal(resizedUrl('https://example.com/a.jpg', 480), null)
  assert.equal(resizedUrl('https://res.cloudinary.com/demo/image/upload/w_200,c_fill/v1/a.jpg', 480), null)
  assert.equal(resizedUrl(undefined, 480), null)
  assert.match(resizedSrcSet(IMG, [320, 640]), /w_320,c_limit\/v123\/saree\.jpg 320w, .*w_640.* 640w$/)
  assert.equal(resizedSrcSet('/local.png', [320, 640]), null)
  assert.match(socialImageUrl(IMG), /f_jpg,q_auto,w_1200,h_1200,c_limit/)
  assert.equal(socialImageUrl('/local.png'), '/local.png')
  assert.equal(cloudinaryUrl(IMG, 'x'), 'https://res.cloudinary.com/demo/image/upload/x/v123/saree.jpg')
})

test('site URL normalisation accepts https origins only', () => {
  assert.equal(normaliseSiteUrl('https://shop.example.com/path'), 'https://shop.example.com')
  assert.equal(normaliseSiteUrl('http://localhost:5173'), 'http://localhost:5173')
  assert.equal(normaliseSiteUrl('http://shop.example.com'), '')
  assert.equal(normaliseSiteUrl(''), '')
})

test('page meta builds canonical URLs and titles for every route type', () => {
  const base = { brandName: 'PSH', description: 'Store description', siteUrl: SITE }
  assert.equal(buildPageMeta({ ...base, pathname: '/' }).canonicalUrl, `${SITE}/`)
  assert.equal(buildPageMeta({ ...base, pathname: '/collection/' }).canonicalUrl, `${SITE}/collection`)
  assert.equal(buildPageMeta({ ...base, pathname: '/category/sarees' }).title, 'Sarees | PSH')
  assert.equal(buildPageMeta({ ...base, pathname: '/collections/diwali' }).title, 'Diwali collection | PSH')
  const policy = buildPageMeta({ ...base, pathname: '/privacy-policy' })
  assert.equal(policy.title, 'Privacy Policy | PSH')
  assert.ok(policy.description)
  assert.equal(buildPageMeta({ ...base, pathname: '/unknown' }).title, 'PSH')
})

const product = {
  _id: 'abc', slug: 'silk-saree', name: 'Silk Saree', description: '<b>Pure</b>   silk', category: 'Sarees',
  price: 1000, mrp: 1500, details: { fabric: 'Silk', colour: 'Red' },
  images: [{ url: IMG, role: 'detail', order: 2 }, { url: IMG, role: 'primary', order: 1, altText: 'Front' }],
  variants: [{ sku: 'S-1', price: 1000, stockOnHand: 3, reserved: 3, active: true }]
}

test('product meta and JSON-LD use only real fields', () => {
  const meta = buildProductMeta(product, { siteUrl: SITE, brandName: 'PSH' })
  assert.equal(meta.canonicalUrl, `${SITE}/product/silk-saree`)
  assert.equal(meta.title, 'Silk Saree | PSH')
  assert.equal(meta.imageAlt, 'Front')
  assert.match(meta.image, /f_jpg/)
  const ld = buildProductJsonLd(product, { siteUrl: SITE, brandName: 'PSH' })
  assert.equal(ld['@type'], 'Product')
  assert.equal(ld.sku, 'S-1')
  assert.equal(ld.material, 'Silk')
  assert.equal(ld.offers.price, '1000.00')
  assert.equal(ld.offers.priceCurrency, 'INR')
  assert.equal(ld.offers.availability, 'https://schema.org/OutOfStock')
  for (const invented of ['aggregateRating', 'review', 'gtin', 'gtin13']) assert.ok(!(invented in ld))
})

test('seo overrides win and missing images yield no image tags', () => {
  const custom = { ...product, images: [], seo: { title: 'Custom', description: 'Custom desc' } }
  const meta = buildProductMeta(custom, { siteUrl: SITE, brandName: 'PSH' })
  assert.equal(meta.title, 'Custom')
  assert.equal(meta.description, 'Custom desc')
  assert.equal(meta.image, '')
  assert.ok(!('image' in buildProductJsonLd(custom, { siteUrl: SITE, brandName: 'PSH' })))
})

test('only absolute https images reach metadata and JSON-LD', () => {
  const hostile = { ...product, images: [
    { url: 'javascript:alert(1)', role: 'primary', order: 0 },
    { url: 'http://insecure.test/a.jpg', order: 1 },
    { url: IMG, order: 2 }
  ] }
  const options = { siteUrl: SITE, brandName: 'PSH' }
  assert.deepEqual(buildProductJsonLd(hostile, options).image, [IMG])
  assert.match(buildProductMeta(hostile, options).image, /^https:\/\/res\.cloudinary\.com\//)
  const none = { ...product, images: [{ url: 'javascript:alert(1)' }] }
  assert.equal(buildProductMeta(none, options).image, '')
  assert.ok(!('image' in buildProductJsonLd(none, options)))
})

test('applyPageMeta writes tags, replaces stale values and removes empty ones', () => {
  const doc = fakeDocument()
  applyPageMeta(doc, buildProductMeta(product, { siteUrl: SITE, brandName: 'PSH' }), 'PSH')
  assert.equal(doc.title, 'Silk Saree | PSH')
  assert.equal(metaContent(doc, 'property', 'og:title'), 'Silk Saree | PSH')
  assert.equal(metaContent(doc, 'name', 'twitter:card'), 'summary_large_image')
  assert.equal(doc.head.querySelector('link[rel="canonical"]').attrs.href, `${SITE}/product/silk-saree`)
  applyPageMeta(doc, buildPageMeta({ pathname: '/', brandName: 'PSH', description: 'd', siteUrl: SITE }), 'PSH')
  assert.equal(metaContent(doc, 'property', 'og:image'), undefined)
  assert.equal(metaContent(doc, 'name', 'twitter:card'), 'summary')
  assert.equal(doc.head.querySelector('link[rel="canonical"]').attrs.href, `${SITE}/`)
  assert.equal(doc.nodes.filter(node => node.attrs.property === 'og:title').length, 1)
})

test('setJsonLd escapes angle brackets and removes the script when cleared', () => {
  const doc = fakeDocument()
  setJsonLd(doc, 'ld', { name: '</script><b>' })
  assert.ok(!doc.getElementById('ld').textContent.includes('<'))
  assert.deepEqual(JSON.parse(doc.getElementById('ld').textContent), { name: '</script><b>' })
  setJsonLd(doc, 'ld', null)
  assert.equal(doc.getElementById('ld'), null)
})
