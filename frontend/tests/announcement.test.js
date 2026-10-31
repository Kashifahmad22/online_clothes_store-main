import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAnnouncement, parseAnnouncementMessages } from '../src/utils/announcement.js'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/components/AnnouncementBar.jsx', import.meta.url), 'utf8')
const navbar = readFileSync(new URL('../src/components/Navbar.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

const festive = 'DIWALI SALE IS LIVE | DISCOVER THE FESTIVE COLLECTION | ELEGANT SAREES & ETHNIC WEAR | THE ART OF INDIAN ETHNIC WEAR'

test('renders nothing when disabled, missing or empty', () => {
  assert.equal(buildAnnouncement(undefined), null)
  assert.equal(buildAnnouncement({ enabled: false, text: festive, url: '' }), null)
  assert.equal(buildAnnouncement({ enabled: 'true', text: festive, url: '' }), null)
  assert.equal(buildAnnouncement({ enabled: true, text: '', url: '' }), null)
  assert.equal(buildAnnouncement({ enabled: true, text: ' | | ', url: '' }), null)
  assert.equal(buildAnnouncement({ enabled: true, text: 42, url: '' }), null)
})

test('builds the four initial messages in order', () => {
  const model = buildAnnouncement({ enabled: true, text: festive, url: '' })
  assert.deepEqual(model.messages, [
    'DIWALI SALE IS LIVE',
    'DISCOVER THE FESTIVE COLLECTION',
    'ELEGANT SAREES & ETHNIC WEAR',
    'THE ART OF INDIAN ETHNIC WEAR'
  ])
  assert.match(model.label, /^DIWALI SALE IS LIVE\. /)
})

test('caps the message count and normalises whitespace', () => {
  const many = Array.from({ length: 12 }, (_, index) => `M${index}`).join('|')
  assert.equal(parseAnnouncementMessages(many).length, 8)
  assert.deepEqual(parseAnnouncementMessages('  a   b |  c '), ['a b', 'c'])
})

test('repeats short content so each group is wider than any viewport', () => {
  const short = buildAnnouncement({ enabled: true, text: 'Sale', url: '' })
  assert.ok(short.repeats > 10)
  const set = (short.messages.join('').length + 3)
  assert.ok(set * short.repeats >= 320)
  const long = buildAnnouncement({ enabled: true, text: 'x'.repeat(170), url: '' })
  assert.equal(long.repeats, 2)
})

test('keeps scroll speed constant by scaling duration with track length', () => {
  const a = buildAnnouncement({ enabled: true, text: 'Sale', url: '' })
  const b = buildAnnouncement({ enabled: true, text: festive, url: '' })
  const pixelsPerSecond = model => (model.messages.reduce((n, m) => n + m.length + 3, 0) * model.repeats * 10) / model.durationSeconds
  assert.ok(Math.abs(pixelsPerSecond(a) - pixelsPerSecond(b)) < 4)
  assert.ok(pixelsPerSecond(b) <= 60)
})

test('only accepts internal paths or HTTPS destinations', () => {
  assert.equal(buildAnnouncement({ enabled: true, text: 'a', url: '/collection' }).url, '/collection')
  const external = buildAnnouncement({ enabled: true, text: 'a', url: 'https://example.test/x' })
  assert.equal(external.isExternal, true)
  for (const url of ['javascript:alert(1)', '//evil.test', 'http://insecure.test', 'data:text/html,x']) {
    assert.equal(buildAnnouncement({ enabled: true, text: 'a', url }).url, '')
  }
})

test('marquee CSS is a seamless transform loop with pause and reduced-motion handling', () => {
  assert.match(css, /@keyframes announcement-marquee\s*{\s*from\s*{\s*transform:\s*translateX\(0\);\s*}\s*to\s*{\s*transform:\s*translateX\(-50%\);/)
  assert.match(css, /animation:\s*announcement-marquee var\(--marquee-duration[^)]*\)\s+linear infinite/)
  assert.match(css, /\.announcement-bar:hover \.announcement-bar__track,\s*\.announcement-bar:focus-within \.announcement-bar__track\s*{\s*animation-play-state:\s*paused/)
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced.slice(0, reduced.indexOf('\n}\n')), /animation:\s*none/)
  assert.match(reduced.slice(0, 1800), /announcement-bar__group:last-child,\s*\.announcement-bar__item--repeat,\s*\.announcement-bar__item:not\(:first-child\),\s*\.announcement-bar__separator\s*{\s*display:\s*none/)
  assert.match(css, /\.announcement-bar\s*{[^}]*overflow:\s*hidden/)
  assert.doesNotMatch(css.slice(css.indexOf('.announcement-bar {'), css.indexOf('@media (prefers-reduced-motion: reduce)')), /setInterval|setTimeout/)
})

test('component duplicates the track once, hides it from assistive tech and exposes one label', () => {
  assert.equal((component.match(/<Group /g) || []).length, 2)
  assert.match(component, /className='announcement-bar__track' aria-hidden='true'/)
  assert.match(component, /className='sr-only'/)
  assert.match(component, /rel='noopener noreferrer'/)
  assert.doesNotMatch(component, /setInterval|setTimeout|requestAnimationFrame/)
})

test('the bar is rendered once, in the shared header, using public settings', () => {
  assert.equal((navbar.match(/<AnnouncementBar /g) || []).length, 1)
  assert.match(navbar, /announcement={siteSettings\.announcement}/)
  assert.doesNotMatch(app, /AnnouncementBar/)
})

test('mobile bar and placeholder share one 44px height for linked and unlinked bars', () => {
  const mobile = css.slice(css.search(/@media \(max-width: 767px\) \{\s*\.announcement-bar-placeholder/))
  assert.match(mobile, /\.announcement-bar-placeholder \{\s*height: 44px/)
  assert.match(mobile, /\.announcement-bar \{\s*border-bottom: 0;\s*box-shadow: inset/)
  assert.match(mobile, /\.announcement-bar__viewport \{\s*height: 44px/)
  assert.doesNotMatch(css, /announcement-bar--link \.announcement-bar__viewport/)
})

test('reserves space while settings load and settles on success or error', () => {
  assert.match(component, /if \(pending\) return <div className='announcement-bar-placeholder'/)
  assert.match(navbar, /pending=\{!siteSettingsLoaded && !siteSettingsError\}/)
  assert.match(css, /\.announcement-bar-placeholder \{\s*height: 33px/)
  assert.doesNotMatch(css.match(/\.announcement-bar-placeholder \{[^}]*\}/)[0], /background|animation/)
})
