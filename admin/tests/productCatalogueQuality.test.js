import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ATTRIBUTE_FIELDS, MAX_ATTRIBUTE_LENGTH, attributeError, cleanAttributes, legacyAttributeNote, tidyAttribute
} from '../src/utils/productAttributes.js'
import {
  MAX_ALT_TEXT_LENGTH, altTextError, countPrimary, imageProblems, imagesUnchanged, moveItem, primaryMessage, setPrimary,
  setRole
} from '../src/utils/productImages.js'

const img = (name, role = 'other', altText = '') => ({ url: `https://x.test/${name}.jpg`, role, altText })
const urls = list => list.map(item => item.url.split('/').pop().replace('.jpg', ''))

test('fabric and colour are optional: blank values are valid and stay blank', () => {
  for (const value of [undefined, null, '', '   ']) assert.equal(attributeError('Fabric', value), '')
  const { details, errors } = cleanAttributes({ fabric: '  ', colour: undefined })
  assert.deepEqual(errors, [])
  assert.equal(details.fabric, '')
  assert.equal(details.colour, '')
})

test('valid fabric and colour are trimmed and inner whitespace collapsed', () => {
  const { details, errors } = cleanAttributes({ fabric: '  Banarasi   Silk ', colour: ' Deep Red\n' })
  assert.deepEqual(errors, [])
  assert.equal(details.fabric, 'Banarasi Silk')
  assert.equal(details.colour, 'Deep Red')
  assert.equal(tidyAttribute(42), '')
})

test('placeholder values are rejected whatever their case or padding', () => {
  for (const value of ['N/A', 'n/a', ' NA ', 'None', 'NULL', 'undefined', 'nil', 'TBD', 'Not specified', 'unknown', '-', '---', '..']) {
    assert.match(attributeError('Colour', value), /cannot be/, value)
  }
  for (const value of ['Nano Cotton', 'Navy', 'Nila', 'Unknown Pleasures Print']) {
    assert.equal(attributeError('Colour', value), '', value)
  }
})

test('over-long values are rejected', () => {
  assert.match(attributeError('Fabric', 'x'.repeat(MAX_ATTRIBUTE_LENGTH + 1)), /characters or fewer/)
  assert.equal(attributeError('Fabric', 'x'.repeat(MAX_ATTRIBUTE_LENGTH)), '')
})

test('cleaning preserves every other existing detail exactly', () => {
  const original = {
    fabric: ' Silk ', colour: 'Red', blousePieceIncluded: true, careInstructions: 'Dry clean',
    specifications: [{ label: 'Weight', value: '600 g' }], legacyKey: { nested: 1 }
  }
  const { details } = cleanAttributes(original)
  assert.deepEqual({ ...details, fabric: ' Silk ' }, original)
  assert.equal(original.fabric, ' Silk ', 'input is not mutated')
})

test('both fields have clear labels and are the existing details keys', () => {
  assert.deepEqual(ATTRIBUTE_FIELDS.map(field => field.key), ['fabric', 'colour'])
  assert.deepEqual(ATTRIBUTE_FIELDS.map(field => field.label), ['Fabric / material', 'Colour'])
})

test('alt text: blank and normal values pass, over-long fails', () => {
  assert.equal(altTextError(1, ''), '')
  assert.equal(altTextError(1, undefined), '')
  assert.equal(altTextError(1, 'Front view of the saree'), '')
  assert.match(altTextError(3, 'a'.repeat(MAX_ALT_TEXT_LENGTH + 1)), /Image 3 alt text/)
})

test('moveItem reorders without mutating and ignores out-of-range moves', () => {
  const list = [img('a'), img('b'), img('c')]
  assert.deepEqual(urls(moveItem(list, 2, 0)), ['c', 'a', 'b'])
  assert.deepEqual(urls(moveItem(list, 0, 1)), ['b', 'a', 'c'])
  assert.equal(moveItem(list, 0, -1), list)
  assert.equal(moveItem(list, 2, 3), list)
  assert.deepEqual(urls(list), ['a', 'b', 'c'])
})

test('making an image primary leaves exactly one primary and moves it to the front of its list', () => {
  const saved = [img('a', 'primary'), img('b'), img('c')]
  const uploads = [img('u1'), img('u2')]
  const fromSaved = setPrimary(saved, uploads, 'saved', 2)
  assert.deepEqual(urls(fromSaved.saved), ['c', 'a', 'b'])
  assert.equal(countPrimary(fromSaved.saved, fromSaved.uploads), 1)
  assert.equal(fromSaved.saved[0].role, 'primary')
  assert.equal(fromSaved.saved[1].role, 'other')
  const fromUpload = setPrimary(saved, uploads, 'upload', 1)
  assert.equal(countPrimary(fromUpload.saved, fromUpload.uploads), 1)
  assert.deepEqual(urls(fromUpload.uploads), ['u2', 'u1'])
  assert.equal(fromUpload.saved[0].role, 'other')
})

test('choosing Primary in the type menu follows the same rule; other types only change that image', () => {
  const saved = [img('a', 'primary'), img('b')]
  assert.equal(countPrimary(...Object.values(setRole(saved, [], 'saved', 1, 'primary'))), 1)
  const changed = setRole(saved, [], 'saved', 1, 'border')
  assert.equal(changed.saved[1].role, 'border')
  assert.equal(changed.saved[0].role, 'primary')
  assert.deepEqual(urls(changed.saved), ['a', 'b'])
})

test('imageProblems reports long alt text and a missing or duplicated primary', () => {
  assert.deepEqual(imageProblems([img('a', 'primary', 'ok')], [img('b')]), [])
  assert.match(imageProblems([img('a', 'primary', 'x'.repeat(200))], [])[0], /alt text/)
  assert.match(imageProblems([img('a', 'primary')], [img('b', 'primary')])[0], /More than one image/)
  assert.match(imageProblems([img('a'), img('b')], [])[0], /No image is marked as the primary/)
  assert.deepEqual(imageProblems([], []), [])
})

test('untouched legacy images are not re-validated, but any change makes the collection strict', () => {
  const legacy = [img('a', 'primary', 'x'.repeat(200)), img('b', 'primary')]
  assert.equal(imagesUnchanged(legacy, [], legacy), true)
  assert.deepEqual(imageProblems(legacy, [], legacy), [])
  assert.ok(primaryMessage(legacy, []).length > 0)
  assert.ok(imageProblems([legacy[1], legacy[0]], [], legacy).length > 0)
  assert.ok(imageProblems(legacy, [img('n')], legacy).length > 0)
  assert.ok(imageProblems(legacy.slice(0, 1), [], legacy).length > 0)
  const repaired = setPrimary([img('a', 'primary', 'ok'), img('b', 'primary')], [], 'saved', 1)
  assert.deepEqual(imageProblems(repaired.saved, [], legacy), [])
  assert.deepEqual(imageProblems([img('a', 'other')], [], undefined).length, 1)
})

test('an untouched legacy placeholder is kept and not rejected; a changed one is validated', () => {
  const original = { fabric: 'N/A', colour: 'none', careInstructions: 'Dry clean' }
  const same = cleanAttributes({ ...original, fabric: '  N/A ' }, original)
  assert.deepEqual(same.errors, [])
  assert.deepEqual(same.details, original)
  assert.ok(legacyAttributeNote('Fabric', 'N/A', original.fabric).includes('placeholder'))
  assert.equal(legacyAttributeNote('Fabric', 'Silk', original.fabric), '')
  assert.equal(attributeError('Fabric', 'N/A', original.fabric), '')
  assert.match(attributeError('Fabric', 'n/a', original.fabric), /placeholder|cannot be/)
  assert.match(cleanAttributes({ ...original, fabric: 'NONE' }, original).errors[0], /cannot be "NONE"/)
  assert.match(cleanAttributes({ ...original, colour: 'x'.repeat(81) }, original).errors[0], /80 characters/)
  const cleared = cleanAttributes({ ...original, fabric: '' }, original)
  assert.deepEqual(cleared.errors, [])
  assert.equal(cleared.details.fabric, '')
  assert.equal(cleanAttributes({ fabric: 'N/A' }).errors.length, 1)
  assert.equal(cleanAttributes({ fabric: ' Silk ' }, {}).details.fabric, 'Silk')
})

test('the form wires fabric/colour for every product type, alt text, ordering and uploaded alt text', () => {
  const form = readFileSync(new URL('../src/pages/Add.jsx', import.meta.url), 'utf8')
  const sareeSection = form.slice(form.indexOf("product.productType === 'saree' && ("))
  assert.doesNotMatch(sareeSection.slice(0, sareeSection.indexOf('Blouse piece inclusion')), /\['fabric'|\['colour'/)
  assert.match(form, /Fabric and colour/)
  assert.match(form, /ATTRIBUTE_FIELDS\.map/)
  assert.match(form, /cleanAttributes\(product\.details, savedDetails\)/)
  assert.match(form, /imageProblems\(product\.images, uploads, savedImages\)/)
  assert.match(form, /formData\.append\('imageAlts'/)
  assert.match(form, /Make primary/)
  assert.match(form, /Move up/)
  assert.match(form, /Move down/)
  assert.match(form, /Alt text \(optional\)/)
})
