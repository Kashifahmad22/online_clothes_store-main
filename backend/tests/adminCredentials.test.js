import assert from 'node:assert/strict'
import test from 'node:test'
import bcrypt from 'bcrypt'
import {
    MAX_PASSWORD_BYTES,
    configureAdminAuth,
    createAdminVerifier,
    isAdminAuthConfigured,
    isBcryptHash,
    loadAdminAuthConfig,
    passwordExceedsBcryptLimit,
    safeEqual,
    verifyAdminCredentials
} from '../utils/adminCredentials.js'
import { parseTrustProxyHops } from '../utils/proxyConfig.js'

const EMAIL = 'owner@example.test'
const PASSWORD = 'correct horse battery staple'
const hash = bcrypt.hashSync(PASSWORD, 10)

test('verifier accepts only the right email and password', async () => {
    const verify = createAdminVerifier({ email: EMAIL, hash })
    assert.equal(await verify(EMAIL, PASSWORD), true)
    assert.equal(await verify(EMAIL, 'wrong password!!'), false)
    assert.equal(await verify('other@example.test', PASSWORD), false)
    assert.equal(await verify(EMAIL.toUpperCase(), PASSWORD), false)
    assert.equal(await verify(undefined, PASSWORD), false)
    assert.equal(await verify(EMAIL, { $ne: '' }), false)
})

test('wrong-email path still performs a bcrypt comparison', async t => {
    const compare = t.mock.method(bcrypt, 'compare', async () => false)
    const verify = createAdminVerifier({ email: EMAIL, hash })
    await verify('other@example.test', PASSWORD)
    assert.equal(compare.mock.callCount(), 1)
    assert.notEqual(compare.mock.calls[0].arguments[1], hash)
    await verify(EMAIL, PASSWORD)
    assert.equal(compare.mock.callCount(), 2)
    assert.equal(compare.mock.calls[1].arguments[1], hash)
})

test('passwords over 72 bytes are rejected rather than truncated', async () => {
    const longPassword = 'a'.repeat(MAX_PASSWORD_BYTES) + 'b'
    const longHash = bcrypt.hashSync('a'.repeat(MAX_PASSWORD_BYTES), 10)
    const verify = createAdminVerifier({ email: EMAIL, hash: longHash })
    assert.equal(await verify(EMAIL, 'a'.repeat(MAX_PASSWORD_BYTES)), true)
    assert.equal(await verify(EMAIL, longPassword), false)
    assert.equal(passwordExceedsBcryptLimit('é'.repeat(37)), true)
    assert.equal(passwordExceedsBcryptLimit('é'.repeat(36)), false)
})

test('safeEqual handles different lengths without throwing', () => {
    assert.equal(safeEqual('a', 'a'), true)
    assert.equal(safeEqual('a', 'ab'), false)
})

test('production refuses to start without a valid bcrypt hash', () => {
    const production = { production: true }
    assert.throws(() => loadAdminAuthConfig({ ADMIN_EMAIL: EMAIL }, production), /ADMIN_PASSWORD_HASH/)
    assert.throws(() => loadAdminAuthConfig({ ADMIN_PASSWORD_HASH: hash }, production), /ADMIN_EMAIL/)
    assert.throws(() => loadAdminAuthConfig({ ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD_HASH: PASSWORD }, production),
        /valid bcrypt hash/)
    assert.throws(() => loadAdminAuthConfig({ ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD_HASH: bcrypt.hashSync('x', 4) },
        production), /cost/)
})

test('plaintext ADMIN_PASSWORD is never used as a fallback', () => {
    const env = { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: PASSWORD }
    assert.throws(() => loadAdminAuthConfig(env, { production: true }))
    assert.equal(loadAdminAuthConfig(env, { production: false }), null)
    assert.equal(configureAdminAuth(env, { production: false }), false)
    assert.equal(isAdminAuthConfigured(), false)
})

test('configured admin auth verifies credentials through the shared verifier', async () => {
    assert.equal(configureAdminAuth({ ADMIN_EMAIL: ` ${EMAIL} `, ADMIN_PASSWORD_HASH: hash }, { production: true }), true)
    assert.equal(await verifyAdminCredentials(EMAIL, PASSWORD), true)
    assert.equal(await verifyAdminCredentials(EMAIL, 'nope'), false)
    configureAdminAuth({}, { production: false })
    assert.equal(await verifyAdminCredentials(EMAIL, PASSWORD), false)
})

test('isBcryptHash validates the format', () => {
    assert.equal(isBcryptHash(hash), true)
    assert.equal(isBcryptHash('plain'), false)
    assert.equal(isBcryptHash(undefined), false)
})

test('TRUST_PROXY_HOPS is validated and never boolean true', () => {
    assert.equal(parseTrustProxyHops(undefined), 0)
    assert.equal(parseTrustProxyHops(''), 0)
    assert.equal(parseTrustProxyHops(' 2 '), 2)
    for (const bad of ['true', '-1', '1.5', '6', 'two', '1e1']) {
        assert.throws(() => parseTrustProxyHops(bad), /TRUST_PROXY_HOPS/, bad)
    }
})
