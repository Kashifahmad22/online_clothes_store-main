import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import storefrontSettingsModel from "../models/storefrontSettingsModel.js";
import { defaultStorefrontSettings } from "../utils/storefrontSettings.js";
import { getSiteUrl } from "../utils/siteUrl.js";
import {
    buildProductSeo,
    buildSitemapEntries,
    latestModified,
    renderProductHtml,
    renderSitemap,
    renderSitemapIndex,
    renderUnavailableHtml
} from "../utils/seo.js";

// Each sitemap file holds at most this many URLs (the protocol limit is 50,000). Larger catalogues
// are served as a sitemap index, so no published product is ever left out.
export const SITEMAP_PAGE_SIZE = 5000;
const PAGE_PATTERN = /^[1-9]\d{0,3}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

// Small bounded cache so crawler bursts and random URLs cannot turn into unbounded DB reads.
export const createTtlCache = ({ ttlMs = 60 * 1000, maxEntries = 500, now = Date.now } = {}) => {
    const entries = new Map();
    return {
        get(key) {
            const hit = entries.get(key);
            if (!hit) return undefined;
            if (hit.expires <= now()) {
                entries.delete(key);
                return undefined;
            }
            return hit.value;
        },
        set(key, value) {
            if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
            entries.set(key, { value, expires: now() + ttlMs });
        },
        clear: () => entries.clear()
    };
};

const defaultDependencies = () => ({
    findPublishedProduct: async identifier => {
        const query = OBJECT_ID_PATTERN.test(identifier) ? { _id: identifier } : { slug: identifier };
        return productModel.findOne({ ...query, status: "published" }).lean();
    },
    findActiveVariants: productId => productVariantModel.find({ productId, active: true }).lean(),
    findPublishedProducts: () => productModel.find({ status: "published" })
        .select("slug updatedAt productType category collections")
        .sort({ updatedAt: -1, _id: 1 })
        .lean(),
    loadSettings: () => storefrontSettingsModel.findOne({ key: "primary" }).lean(),
    getSiteUrl: () => getSiteUrl()
});

const logFailure = (label, error) => {
    console.error(label, { name: typeof error?.name === "string" ? error.name : "Error" });
};

export const createSeoHandlers = (overrides = {}, { cache = createTtlCache() } = {}) => {
    const deps = { ...defaultDependencies(), ...overrides };
    const brandNameFrom = settings => settings?.brand?.publicName || defaultStorefrontSettings.brand.publicName;

    const sendCached = (res, entry) => {
        res.status(entry.status);
        for (const [header, value] of Object.entries(entry.headers)) res.set(header, value);
        return res.type(entry.type).send(entry.body);
    };

    // Responses vary by User-Agent at the edge, so they must never be stored by shared caches.
    const productHeaders = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noarchive" };

    const productPreview = async (req, res) => {
        const identifier = String(req.params.productId || "").toLowerCase();
        const siteUrl = deps.getSiteUrl();
        const cacheKey = `product:${siteUrl}:${identifier}`;
        const cached = cache.get(cacheKey);
        if (cached) return sendCached(res, cached);

        const valid = SLUG_PATTERN.test(identifier) || OBJECT_ID_PATTERN.test(identifier);
        try {
            const settings = await deps.loadSettings();
            const brandName = brandNameFrom(settings);
            const product = valid ? await deps.findPublishedProduct(identifier) : null;
            let entry;
            if (!product) {
                entry = {
                    status: 404,
                    type: "html",
                    headers: { ...productHeaders, "X-Robots-Tag": "noindex" },
                    body: renderUnavailableHtml({ siteUrl, brandName })
                };
            } else {
                const variants = await deps.findActiveVariants(product._id);
                const seo = buildProductSeo(product, variants, { siteUrl, brandName });
                entry = {
                    status: 200,
                    type: "html",
                    headers: productHeaders,
                    body: renderProductHtml(seo, { brandName, productName: product.name })
                };
            }
            cache.set(cacheKey, entry);
            return sendCached(res, entry);
        } catch (error) {
            logFailure("Product preview request failed:", error);
            res.set("Retry-After", "60");
            return res.status(503).type("text").send("Product preview is temporarily unavailable.");
        }
    };

    const sitemapHeaders = { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" };

    const loadSitemapEntries = async siteUrl => {
        const cacheKey = `sitemap-entries:${siteUrl}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        const [products, settings] = await Promise.all([deps.findPublishedProducts(), deps.loadSettings()]);
        const entries = buildSitemapEntries({ siteUrl, products, policies: settings?.policies || {} });
        cache.set(cacheKey, entries);
        return entries;
    };

    const sitemapFailure = (res, error) => {
        logFailure("Sitemap request failed:", error);
        res.set("Retry-After", "300");
        return res.status(503).type("text").send("Sitemap is temporarily unavailable.");
    };

    const sitemap = async (req, res) => {
        const siteUrl = deps.getSiteUrl();
        try {
            const entries = await loadSitemapEntries(siteUrl);
            res.set(sitemapHeaders);
            if (entries.length <= SITEMAP_PAGE_SIZE) return res.type("application/xml").send(renderSitemap(entries));
            const pages = Math.ceil(entries.length / SITEMAP_PAGE_SIZE);
            const items = Array.from({ length: pages }, (_, index) => ({
                loc: `${siteUrl}/sitemaps/${index + 1}`,
                lastmod: latestModified(entries.slice(index * SITEMAP_PAGE_SIZE, (index + 1) * SITEMAP_PAGE_SIZE))
            }));
            return res.type("application/xml").send(renderSitemapIndex(items));
        } catch (error) {
            return sitemapFailure(res, error);
        }
    };

    // Only exists when the catalogue is large enough that /sitemap.xml is an index.
    const sitemapPage = async (req, res) => {
        const siteUrl = deps.getSiteUrl();
        const page = String(req.params.page || "");
        if (!PAGE_PATTERN.test(page)) return res.status(404).type("text").send("Not found.");
        try {
            const entries = await loadSitemapEntries(siteUrl);
            const start = (Number(page) - 1) * SITEMAP_PAGE_SIZE;
            if (entries.length <= SITEMAP_PAGE_SIZE || start >= entries.length) {
                return res.status(404).type("text").send("Not found.");
            }
            res.set(sitemapHeaders);
            return res.type("application/xml").send(renderSitemap(entries.slice(start, start + SITEMAP_PAGE_SIZE)));
        } catch (error) {
            return sitemapFailure(res, error);
        }
    };

    return { productPreview, sitemap, sitemapPage };
};

const handlers = createSeoHandlers();
export const productPreview = handlers.productPreview;
export const sitemap = handlers.sitemap;
export const sitemapPage = handlers.sitemapPage;
