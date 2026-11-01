import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PAGE_SIZE, correctedPage, createLatestGate, loadErrorMessage, pageSummary, parsePageParam
} from '../src/utils/catalogueList.js'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('page parameter parsing falls back to page 1 for anything malformed', () => {
  assert.equal(PAGE_SIZE, 20)
  assert.equal(parsePageParam(null), 1)
  assert.equal(parsePageParam('3'), 3)
  for (const bad of ['0', '-2', '1.5', 'abc', '', '1e3', ' 2', '99999999']) assert.equal(parsePageParam(bad), 1, bad)
})

test('an out-of-range page is corrected to the nearest valid page', () => {
  assert.equal(correctedPage({ page: 3, totalPages: 2 }), 2)
  assert.equal(correctedPage({ page: 2, totalPages: 0 }), 1)
  assert.equal(correctedPage({ page: 2, totalPages: 2 }), null)
  assert.equal(correctedPage({ page: 1, totalPages: 0 }), null)
})

test('page summary drives the Previous/Next disabled states and counts', () => {
  const first = pageSummary({ page: 1, limit: 20, totalProducts: 45, totalPages: 3 })
  assert.deepEqual([first.from, first.to, first.hasPrevious, first.hasNext], [1, 20, false, true])
  const last = pageSummary({ page: 3, limit: 20, totalProducts: 45, totalPages: 3 })
  assert.deepEqual([last.from, last.to, last.hasPrevious, last.hasNext], [41, 45, true, false])
  const empty = pageSummary({ page: 1, limit: 20, totalProducts: 0, totalPages: 0 })
  assert.deepEqual([empty.from, empty.to, empty.hasPrevious, empty.hasNext], [0, 0, false, false])
})

test('a stale response can never be treated as current', () => {
  const gate = createLatestGate()
  const first = gate.next()
  const second = gate.next()
  assert.equal(gate.isCurrent(first), false)
  assert.equal(gate.isCurrent(second), true)
  gate.invalidate()
  assert.equal(gate.isCurrent(second), false)
})

test('load error messages distinguish server, network and unexpected failures', () => {
  assert.equal(loadErrorMessage({ response: { data: { message: 'Bad limit' } } }), 'Bad limit')
  assert.match(loadErrorMessage({ response: { status: 503, data: {} } }), /server could not/)
  assert.match(loadErrorMessage({ request: {} }), /Unable to reach/)
  assert.equal(loadErrorMessage(new Error('odd')), 'odd')
})

test('the list page shows errors and empty states separately and keeps the page in the URL', () => {
  const list = source('../src/pages/List.jsx')
  assert.match(list, /useSearchParams/)
  assert.match(list, /Retry/)
  assert.match(list, /role='alert'/)
  assert.match(list, /showTable = !loadError && summary/)
  assert.match(list, /signal: controller\.signal/)
  assert.match(list, /gate\.isCurrent\(requestId\)/)
  assert.match(list, /disabled=\{loading \|\| !summary\.hasPrevious\}/)
  assert.match(list, /disabled=\{loading \|\| !summary\.hasNext\}/)
  // The failure branch must clear the list and must not set an empty-catalogue state.
  const catchBlock = list.slice(list.indexOf('} catch (error) {'), list.indexOf('}, [token, page'))
  assert.match(catchBlock, /setLoadError/)
  assert.doesNotMatch(catchBlock, /No products yet/)
})

test('the edit form loads a single product and never the whole catalogue', () => {
  const add = source('../src/pages/Add.jsx')
  assert.doesNotMatch(add, /product\/admin\/list/)
  assert.match(add, /api\/product\/admin\/\$\{encodeURIComponent\(editId\)\}/)
  assert.match(add, /loadState !== 'ready'/)
  assert.match(add, /Product not found/)
  assert.match(add, /Retry/)
  // The dirty baseline is reset before loading and set from the loaded product, and blockers remain.
  assert.match(add, /setBaseline\(formSnapshot\(loaded, tags\)\)/)
  assert.match(add, /useBlocker/)
  assert.match(add, /Cancel|hasUnsavedChanges\(\)/)
})

test('switching the product id in place never shows the previous product', async () => {
  const { resolveLoadState } = await import('../src/utils/catalogueList.js')
  const loadedA = { key: 'aaa', state: 'ready', message: '' }
  assert.equal(resolveLoadState(loadedA, 'aaa'), 'ready')
  assert.equal(resolveLoadState(loadedA, 'bbb'), 'loading')
  assert.equal(resolveLoadState(loadedA, ''), 'loading')
  assert.equal(resolveLoadState({ key: 'aaa', state: 'error', message: 'x' }, 'bbb'), 'loading')
  assert.equal(resolveLoadState({ key: '', state: 'ready', message: '' }, ''), 'ready')
  const add = source('../src/pages/Add.jsx')
  assert.match(add, /resolveLoadState\(loadInfo, formKey\)/)
  assert.match(add, /if \(loadState !== 'ready'\)/)
  assert.match(add, /controller\.signal\.aborted/)
  assert.match(add, /return \(\) => controller\.abort\(\)/)
})
