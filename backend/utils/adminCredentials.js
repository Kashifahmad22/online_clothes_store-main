import bcrypt from 'bcrypt'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const MAX_PASSWORD_BYTES = 72
export const MIN_BCRYPT_ROUNDS = 10
export const MAX_BCRYPT_ROUNDS = 15

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

export const isBcryptHash = value => typeof value === 'string' && BCRYPT_HASH_PATTERN.test(value)

// bcrypt silently ignores bytes past 72, so longer passwords are rejected instead.
export const passwordExceedsBcryptLimit = password =>
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES

const digest = value => createHash('sha256').update(value, 'utf8').digest()

export const safeEqual = (left, right) => timingSafeEqual(digest(left), digest(right))

export const createAdminVerifier = ({ email, hash }) => {
    const rounds = bcrypt.getRounds(hash)
    // A throwaway hash at the same cost keeps wrong-email requests as slow as wrong-password ones.
    const dummyHash = bcrypt.hashSync(randomBytes(24).toString('hex'), rounds)
    return async (candidateEmail, candidatePassword) => {
        if (typeof candidateEmail !== 'string' || typeof candidatePassword !== 'string' ||
            passwordExceedsBcryptLimit(candidatePassword)) {
            return false
        }
        const emailMatches = safeEqual(candidateEmail, email)
        const passwordMatches = await bcrypt.compare(candidatePassword, emailMatches ? hash : dummyHash)
        return emailMatches && passwordMatches
    }
}

// Production requires a bcrypt hash; plaintext ADMIN_PASSWORD is never read.
export const loadAdminAuthConfig = (env, { production }) => {
    const email = env.ADMIN_EMAIL?.trim() || ''
    const hash = env.ADMIN_PASSWORD_HASH?.trim() || ''

    if (production && (!email || !hash)) {
        throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD_HASH must be configured in production.')
    }
    if (hash) {
        if (!isBcryptHash(hash)) {
            throw new Error('ADMIN_PASSWORD_HASH must be a valid bcrypt hash.')
        }
        const rounds = bcrypt.getRounds(hash)
        if (rounds < MIN_BCRYPT_ROUNDS || rounds > MAX_BCRYPT_ROUNDS) {
            throw new Error(`ADMIN_PASSWORD_HASH must use bcrypt cost ${MIN_BCRYPT_ROUNDS}-${MAX_BCRYPT_ROUNDS}.`)
        }
    }
    if (!email || !hash) return null
    return { email, hash }
}

let adminVerifier = null

export const configureAdminAuth = (env, options) => {
    const config = loadAdminAuthConfig(env, options)
    adminVerifier = config ? createAdminVerifier(config) : null
    return Boolean(adminVerifier)
}

export const isAdminAuthConfigured = () => adminVerifier !== null

export const verifyAdminCredentials = (email, password) =>
    adminVerifier ? adminVerifier(email, password) : Promise.resolve(false)
