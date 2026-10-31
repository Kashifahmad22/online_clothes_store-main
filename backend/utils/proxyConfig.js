export const MAX_TRUST_PROXY_HOPS = 5

// Number of proxies between the internet and this app whose X-Forwarded-For entries are trusted.
// 0 trusts none, so req.ip is the direct socket peer.
export const parseTrustProxyHops = value => {
    if (value === undefined || value === null || String(value).trim() === '') return 0
    const raw = String(value).trim()
    const hops = /^\d+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isInteger(hops) || hops > MAX_TRUST_PROXY_HOPS) {
        throw new Error(`TRUST_PROXY_HOPS must be an integer from 0 to ${MAX_TRUST_PROXY_HOPS}.`)
    }
    return hops
}

// Production must state the hop count explicitly: a silent default of 0 would make every
// visitor share the proxy's rate-limit bucket. Development keeps the convenient default of 0.
export const resolveTrustProxyHops = (value, { production }) => {
    const isSet = value !== undefined && value !== null && String(value).trim() !== ''
    if (production && !isSet) {
        throw new Error(
            `TRUST_PROXY_HOPS must be set explicitly in production (integer 0-${MAX_TRUST_PROXY_HOPS}). ` +
            'See backend/README.md for how to establish the correct value.'
        )
    }
    return parseTrustProxyHops(value)
}
