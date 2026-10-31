import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { policyPages } from '../src/config/policies.js'

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const rewriteRegex = new RegExp(`^${vercel.rewrites.find(item => item.destination === '/index.html').source}$`)

test('four policy pages have unique keys and paths', () => {
    assert.deepEqual(policyPages.map(page => page.key).sort(), ['privacy', 'returns', 'shipping', 'terms'])
    assert.equal(new Set(policyPages.map(page => page.path)).size, 4)
})

test('policy paths resolve through the SPA rewrite', () => {
    for (const page of policyPages) assert.ok(rewriteRegex.test(page.path), page.path)
})

test('policy descriptions make no legal, delivery or refund claims', () => {
    for (const page of policyPages) assert.doesNotMatch(page.description, /\d|days?|free|guarantee/i)
})
