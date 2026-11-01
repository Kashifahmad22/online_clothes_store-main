import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { availableStock, buildAdjustment, negativeConfirmMessage } from '../src/utils/stockAdjustment.js'
import { createExclusiveRunner } from '../src/utils/submissionGuard.js'
import { confirmLeave, guardNavigation, setUnsavedChanges, hasUnsavedChanges } from '../src/utils/unsavedChanges.js'
import { isArchived, selectableStatuses, statusButtons, statusConfirmMessage, statusLabel } from '../src/utils/productStatus.js'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('stock adjustment validation', () => {
  assert.deepEqual(buildAdjustment({ operation: 'receive', quantity: '10' }),
    { body: { operation: 'receive', quantity: 10 }, negative: false })
  for (const quantity of ['', '0', '1.5', 'abc', '1e3', '100001']) {
    assert.ok(buildAdjustment({ operation: 'receive', quantity }).error, quantity)
  }
  assert.match(buildAdjustment({ operation: 'receive', quantity: '-1' }).error, /positive/)
  assert.match(buildAdjustment({ operation: 'correction', quantity: '-1', reason: '' }).error, /reason/i)
  assert.ok(buildAdjustment({ operation: 'unknown', quantity: '1' }).error)
})

test('negative corrections are flagged for confirmation; positive ones are not', () => {
  const negative = buildAdjustment({ operation: 'correction', quantity: '-3', reason: ' Damaged ' })
  assert.equal(negative.negative, true)
  assert.equal(negative.body.reason, 'Damaged')
  assert.equal(buildAdjustment({ operation: 'correction', quantity: '2', reason: 'Recount' }).negative, false)
  assert.match(negativeConfirmMessage('SKU1', -3), /Remove 3 piece/)
})

test('available stock never goes below zero', () => {
  assert.equal(availableStock({ stockOnHand: 5, reserved: 2 }), 3)
  assert.equal(availableStock({ stockOnHand: 1, reserved: 4 }), 0)
  assert.equal(availableStock({}), 0)
})

test('exclusive runner ignores duplicate submissions while busy', async () => {
  const run = createExclusiveRunner()
  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const first = run(async () => { calls += 1; await gate; return 'done' })
  const second = await run(async () => { calls += 1 })
  assert.equal(second.skipped, true)
  release()
  assert.deepEqual(await first, { skipped: false, value: 'done' })
  assert.equal(calls, 1)
  assert.equal((await run(async () => { calls += 1 })).skipped, false)
  assert.equal(calls, 2)
})

test('unsaved changes guard prompts only when dirty and respects the answer', () => {
  setUnsavedChanges(false)
  assert.equal(confirmLeave(() => { throw new Error('should not prompt') }), true)
  setUnsavedChanges(true)
  assert.equal(confirmLeave(() => false), false)
  assert.equal(hasUnsavedChanges(), true)
  let prevented = false
  guardNavigation({ preventDefault: () => { prevented = true } }, () => false)
  assert.equal(prevented, true)
  assert.equal(confirmLeave(() => true), true)
  assert.equal(hasUnsavedChanges(), false)
})

test('archived products are labelled correctly and can only be restored to Draft', () => {
  assert.equal(statusLabel('archived'), 'Archived')
  assert.equal(isArchived('archived'), true)
  assert.deepEqual(selectableStatuses('archived'), [])
  assert.deepEqual(statusButtons('archived'), [{ action: 'draft', label: 'Restore to Draft', confirm: false }])
  assert.equal(statusButtons('archived').some(button => button.action === 'published'), false)
  assert.ok(statusButtons('published').every(button => button.confirm))
  assert.match(statusConfirmMessage('archived', 'Silk'), /Archive/)
})

test('edit form: saved SKUs are read-only, deactivation is confirmed, stock uses the dedicated adjuster', () => {
  const form = source('../src/pages/Add.jsx')
  assert.match(form, /readOnly=\{saved\}/)
  assert.match(form, /window\.confirm\(`Deactivate SKU/)
  assert.match(form, /<StockAdjuster/)
  assert.match(form, /Restore to Draft/)
  assert.match(form, /priceOverridePaise: variant\.priceOverride === '' \|\| variant\.priceOverride === undefined\s*\? null/)
  assert.match(form, /const mrpPaise = product\.mrp === '' \? null/)
  assert.match(form, /beforeunload/)
  assert.doesNotMatch(form, /Remove SKU</)
})

test('stock adjuster blocks duplicate submits and confirms negative corrections', () => {
  const adjuster = source('../src/components/StockAdjuster.jsx')
  assert.match(adjuster, /if \(busyRef\.current\) return/)
  assert.match(adjuster, /result\.negative &&\s*!window\.confirm/)
  assert.match(adjuster, /disabled=\{busy\}/)
  assert.match(adjuster, /\/variants\/\$\{variant\._id\}\/stock/)
})

test('navigation is blocked by a router blocker (Back/Forward and links); Logout keeps its own guard', () => {
  assert.match(source('../src/main.jsx'), /createBrowserRouter/)
  const form = source('../src/pages/Add.jsx')
  assert.match(form, /useBlocker\(/)
  assert.match(form, /blocker\.proceed\(\)/)
  assert.match(form, /blocker\.reset\(\)/)
  assert.match(form, /setUnsavedChanges\(false\)\s*\n\s*navigate\('\/list'\)/)
  assert.match(source('../src/components/Navbar.jsx'), /confirmLeave\(\)/)
})
