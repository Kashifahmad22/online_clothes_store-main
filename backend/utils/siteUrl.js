// The public storefront origin used for canonical URLs, Open Graph tags and the sitemap.
// When the custom domain is chosen, set SITE_URL on the Render service; nothing else in the
// backend needs to change.
export const DEFAULT_SITE_URL = "https://frontend-omega-red-85.vercel.app";

const isLocalHost = hostname => hostname === "localhost" || hostname === "127.0.0.1";

// Returns a normalised origin (no path, query or trailing slash). Invalid values fall back to
// the default instead of crashing the service.
export const resolveSiteUrl = value => {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return { siteUrl: DEFAULT_SITE_URL, valid: true, configured: false };
    try {
        const parsed = new URL(raw);
        const secure = parsed.protocol === "https:" ||
            (parsed.protocol === "http:" && isLocalHost(parsed.hostname));
        if (!secure || parsed.username || parsed.password) throw new Error("unsupported");
        return { siteUrl: parsed.origin, valid: true, configured: true };
    } catch {
        return { siteUrl: DEFAULT_SITE_URL, valid: false, configured: true };
    }
};

let warned = false;

export const getSiteUrl = (env = process.env) => {
    const result = resolveSiteUrl(env.SITE_URL);
    if (!result.valid && !warned) {
        warned = true;
        console.warn("SITE_URL is not a valid HTTPS origin; using the default storefront URL.");
    }
    return result.siteUrl;
};
