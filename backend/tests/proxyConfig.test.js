import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MAX_TRUST_PROXY_HOPS, parseTrustProxyHops, resolveTrustProxyHops } from '../utils/proxyConfig.js'

test('valid hop counts are accepted', () => {
    for (let n = 0; n <= MAX_TRUST_PROXY_HOPS; n++) {
        assert.equal(parseTrustProxyHops(String(n)), n)
        assert.equal(resolveTrustProxyHops(` ${n} `, { production: true }), n)
    }
})

test('invalid hop counts are rejected', () => {
    for (const bad of ['true', 'false', '-1', '1.5', '1e1', '6', '99', 'abc', '0x2', '2 3']) {
        assert.throws(() => parseTrustProxyHops(bad), /TRUST_PROXY_HOPS/, bad)
        assert.throws(() => resolveTrustProxyHops(bad, { production: true }), /TRUST_PROXY_HOPS/, bad)
    }
})

test('production requires an explicit value; development defaults to 0', () => {
    for (const unset of [undefined, null, '', '   ']) {
        assert.throws(() => resolveTrustProxyHops(unset, { production: true }), /set explicitly in production/)
        assert.equal(resolveTrustProxyHops(unset, { production: false }), 0)
    }
    assert.equal(resolveTrustProxyHops('0', { production: true }), 0)
})

test('server refuses to start in production without TRUST_PROXY_HOPS', () => {
    const backendDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
    // A temp cwd stops dotenv from loading the developer's real .env file.
    const cwd = mkdtempSync(join(tmpdir(), 'psh-startup-'))
    try {
        const env = {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: 'production',
            JWT_SECRET: 'x'.repeat(40),
            MONGODB_URI: 'mongodb://127.0.0.1:1/unused',
            CLOUDINARY_NAME: 'n',
            CLOUDINARY_API_KEY: 'k',
            CLOUDINARY_SECRET_KEY: 's',
            CORS_ORIGINS: 'https://shop.example.com',
            ADMIN_EMAIL: 'admin@example.com',
            ADMIN_PASSWORD_HASH: '$2b$12$' + 'a'.repeat(53)
        }
        const result = spawnSync(process.execPath, [join(backendDir, 'server.js')], {
            cwd, env, encoding: 'utf8', timeout: 15000
        })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr + result.stdout, /TRUST_PROXY_HOPS must be set explicitly in production/)
    } finally {
        rmSync(cwd, { recursive: true, force: true })
    }
})
