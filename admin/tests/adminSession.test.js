import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readAdminToken, shouldEndSession, writeAdminToken } from '../src/utils/adminSession.js'

const makeStorage = (initial = {}) => {
    const data = new Map(Object.entries(initial))
    return {
        getItem: key => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: key => data.delete(key),
        has: key => data.has(key)
    }
}

test('token is stored in sessionStorage only and survives a refresh', () => {
    const session = makeStorage()
    const legacy = makeStorage()
    writeAdminToken('abc', session)
    assert.equal(session.getItem('token'), 'abc')
    assert.equal(legacy.has('token'), false)
    assert.equal(readAdminToken(session, legacy), 'abc')
})

test('a new tab or closed session starts signed out', () => {
    assert.equal(readAdminToken(makeStorage(), makeStorage()), '')
})

test('legacy localStorage tokens are deleted and not adopted', () => {
    const legacy = makeStorage({ token: 'old-token' })
    assert.equal(readAdminToken(makeStorage(), legacy), '')
    assert.equal(legacy.has('token'), false)
})

test('logout and empty tokens clear the stored session', () => {
    const session = makeStorage({ token: 'abc' })
    writeAdminToken('', session)
    assert.equal(session.has('token'), false)
})

test('blocked storage does not break the app', () => {
    const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
    assert.equal(readAdminToken(broken, broken), '')
    assert.doesNotThrow(() => writeAdminToken('abc', broken))
})

test('only 401s on authenticated requests end the session', () => {
    assert.equal(shouldEndSession({ response: { status: 401 }, config: { headers: { token: 'abc' } } }), true)
    assert.equal(shouldEndSession({ response: { status: 401 }, config: { headers: {} } }), false)
    assert.equal(shouldEndSession({ response: { status: 403 }, config: { headers: { token: 'abc' } } }), false)
    assert.equal(shouldEndSession({ message: 'Network Error' }), false)
})

test('admin CSP blocks scripts, framing and plugins and allows only needed origins', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    const headers = Object.fromEntries(config.headers[0].headers.map(item => [item.key, item.value]))
    const csp = headers['Content-Security-Policy']
    const directives = Object.fromEntries(csp.split(';').map(part => {
        const [name, ...values] = part.trim().split(/\s+/)
        return [name, values]
    }))
    assert.deepEqual(directives['script-src'], ["'self'"])
    assert.deepEqual(directives['frame-ancestors'], ["'none'"])
    assert.deepEqual(directives['object-src'], ["'none'"])
    assert.deepEqual(directives['default-src'], ["'self'"])
    assert.ok(directives['connect-src'].includes('https://patna-saree-handloom.onrender.com'))
    assert.ok(!csp.includes('unsafe-eval'))
    assert.ok(!directives['script-src'].includes("'unsafe-inline'"))
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
})
