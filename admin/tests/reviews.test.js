import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildListParams, moderationActions, sourceLabel, validateImport, validateModerationInput
} from '../src/utils/reviews.js'

test('reject, hide and flag need a reason; approve does not', () => {
  assert.ok(validateModerationInput('reject', '').error)
  assert.ok(validateModerationInput('hide', '   ').error)
  assert.ok(validateModerationInput('flag', undefined).error)
  assert.deepEqual(validateModerationInput('approve', ''), { reason: '' })
  assert.deepEqual(validateModerationInput('reject', ' spam '), { reason: 'spam' })
  assert.ok(validateModerationInput('reject', 'x'.repeat(501)).error)
})

test('no action is offered that would leave the status unchanged', () => {
  assert.deepEqual(moderationActions('approved').map(a => a.action), ['reject', 'hide', 'flag'])
  assert.deepEqual(moderationActions('pending').map(a => a.action), ['approve', 'reject', 'hide', 'flag'])
  assert.equal(moderationActions('hidden').some(a => a.action === 'hide'), false)
})

test('list params only include valid filters', () => {
  assert.deepEqual(buildListParams({ status: 'pending', rating: '4', source: 'imported', q: ' silk ', page: 2 }),
    { page: 2, limit: 20, status: 'pending', rating: '4', source: 'imported', q: 'silk' })
  assert.deepEqual(buildListParams({ status: 'bogus', rating: '9', source: 'x', q: ' ' }), { page: 1, limit: 20 })
})

const valid = { productId: 'p1', rating: '5', title: '', body: ' Lovely ', displayName: ' Meena ', source: 'WhatsApp', reviewDate: '2024-01-05', permissionConfirmed: true }

test('manual import requires every genuine-feedback field and permission', () => {
  const ok = validateImport(valid)
  assert.equal(ok.error, undefined)
  assert.equal(ok.payload.rating, 5)
  assert.equal(ok.payload.body, 'Lovely')
  assert.equal(ok.payload.permissionConfirmed, true)
  assert.equal('verifiedPurchase' in ok.payload, false)
  for (const bad of [{ productId: '' }, { rating: '' }, { rating: '7' }, { body: ' ' }, { displayName: '' }, { source: '' },
    { reviewDate: '' }, { reviewDate: '2999-01-01' }, { permissionConfirmed: false }]) {
    assert.ok(validateImport({ ...valid, ...bad }).error, JSON.stringify(bad))
  }
})

test('imported reviews are never labelled verified', () => {
  assert.match(sourceLabel({ source: 'imported', verifiedPurchase: true, imported: { source: 'WhatsApp' } }), /Imported manually \(WhatsApp\)/)
  assert.match(sourceLabel({ source: 'customer', verifiedPurchase: true }), /verified purchase/)
  assert.match(sourceLabel({ source: 'customer', verifiedPurchase: false }), /not verified/)
})
