export const MAX_TRUST_PROXY_HOPS = 5

// Number of proxies between the internet and this app whose X-Forwarded-For entries are trusted.
// 0 (the default) trusts none, so req.ip is the direct socket peer.
export const parseTrustProxyHops = value => {
    if (value === undefined || value === null || String(value).trim() === '') return 0
    const raw = String(value).trim()
    const hops = /^\d+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isInteger(hops) || hops > MAX_TRUST_PROXY_HOPS) {
        throw new Error(`TRUST_PROXY_HOPS must be an integer from 0 to ${MAX_TRUST_PROXY_HOPS}.`)
    }
    return hops
}
