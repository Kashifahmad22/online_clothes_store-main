import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePolicyText } from '../src/utils/policyFormat.js'

test('policy text becomes headings, paragraphs and lists', () => {
  const blocks = parsePolicyText('Returns window:\n\nItems may be returned if unused.\nKeep the tags on.\n\n- Original packaging\n- Invoice\n\n1. Contact us\n2. Ship it back\n\nSHIPPING\n\nWe ship across India.')
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'list', 'list', 'heading', 'paragraph'])
  assert.equal(blocks[0].text, 'Returns window')
  assert.equal(blocks[1].text, 'Items may be returned if unused.\nKeep the tags on.')
  assert.deepEqual(blocks[2], { type: 'list', ordered: false, items: ['Original packaging', 'Invoice'] })
  assert.equal(blocks[3].ordered, true)
})

test('a lone short line or sentence is never turned into a heading', () => {
  assert.equal(parsePolicyText('Only line')[0].type, 'paragraph')
  assert.equal(parsePolicyText('Sentence ends here.\n\nBody text follows.')[0].type, 'paragraph')
  assert.deepEqual(parsePolicyText('  \n\n '), [])
})
