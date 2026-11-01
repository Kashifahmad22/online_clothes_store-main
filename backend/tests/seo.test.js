import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import productModel from "../models/productModel.js";
import {
    DEFAULT_SITE_URL,
    resolveSiteUrl
} from "../utils/siteUrl.js";
import {
    buildProductSeo,
    buildSitemapEntries,
    categorySlugsFor,
    cloudinaryImage,
    escapeHtml,
    publicImageUrl,
    renderProductHtml,
    renderSitemap,
    renderSitemapIndex,
    serializeJsonLd
} from "../utils/seo.js";
import { createSeoHandlers, createTtlCache, SITEMAP_PAGE_SIZE } from "../controllers/seoController.js";
import { toPublicStorefrontSettings, defaultStorefrontSettings } from "../utils/storefrontSettings.js";

const SITE = "https://shop.example.test";
const IMAGE = "https://res.cloudinary.com/demo/image/upload/v123/patna-saree-handloom/products/a.jpg";

const product = (overrides = {}) => ({
    _id: "64b7f0c2a1b2c3d4e5f60718",
    name: "Cotton Saree",
    slug: "j13",
    description: "A soft cotton saree.\n\nWith a blouse piece.",
    productType: "saree",
    category: "Sarees",
    collections: ["Diwali"],
    pricePaise: 100000,
    mrpPaise: 149995,
    images: [
        { url: "https://res.cloudinary.com/demo/image/upload/v1/folder/second.jpg", role: "full-saree", order: 1 },
        { url: IMAGE, role: "primary", altText: "Front view", order: 0 }
    ],
    details: { fabric: "Cotton", colour: "", weightCategory: "600g" },
    status: "published",
    updatedAt: new Date("2026-10-01T10:00:00Z"),
    legacyData: { secret: "must never appear" },
    ...overrides
});
const variant = (overrides = {}) => ({
    sku: "J13-RED", stockOnHand: 5, reserved: 1, active: true, ...overrides
});

test("site URL resolves to a safe origin and falls back instead of failing", () => {
    assert.equal(resolveSiteUrl(undefined).siteUrl, DEFAULT_SITE_URL);
    assert.equal(resolveSiteUrl("  https://www.example.in/some/path/?q=1 ").siteUrl, "https://www.example.in");
    assert.equal(resolveSiteUrl("http://localhost:5173").siteUrl, "http://localhost:5173");
    for (const bad of ["http://example.com", "ftp://example.com", "javascript:alert(1)", "not a url",
        "https://user:pass@example.com"]) {
        const result = resolveSiteUrl(bad);
        assert.equal(result.siteUrl, DEFAULT_SITE_URL, bad);
        assert.equal(result.valid, false, bad);
    }
});

test("public storefront settings expose the configured site URL", () => {
    const publicSettings = toPublicStorefrontSettings(defaultStorefrontSettings);
    assert.match(publicSettings.siteUrl, /^https?:\/\//);
});

test("Cloudinary transformations are inserted once and non-Cloudinary URLs are untouched", () => {
    assert.equal(cloudinaryImage(IMAGE, "f_jpg,w_1200"),
        "https://res.cloudinary.com/demo/image/upload/f_jpg,w_1200/v123/patna-saree-handloom/products/a.jpg");
    const transformed = "https://res.cloudinary.com/demo/image/upload/w_300,c_fill/v1/a.jpg";
    assert.equal(cloudinaryImage(transformed, "f_jpg"), transformed);
    assert.equal(cloudinaryImage("https://example.com/a.jpg", "f_jpg"), "https://example.com/a.jpg");
    assert.equal(cloudinaryImage("", "f_jpg"), "");
});

test("product SEO uses real data only and never invents ratings, GTINs or shipping promises", () => {
    const seo = buildProductSeo(product(), [variant()], { siteUrl: SITE, brandName: "PSH" });
    assert.equal(seo.canonicalUrl, `${SITE}/product/j13`);
    assert.equal(seo.title, "Cotton Saree | PSH");
    assert.equal(seo.description, "A soft cotton saree. With a blouse piece.");
    assert.match(seo.imageUrl, /f_jpg,q_auto,w_1200,h_1200,c_limit\/v123\//);
    assert.equal(seo.imageAlt, "Front view");
    const ld = seo.jsonLd;
    assert.equal(ld["@type"], "Product");
    assert.equal(ld.sku, "J13-RED");
    assert.equal(ld.material, "Cotton");
    assert.equal("color" in ld, false);
    assert.deepEqual(ld.brand, { "@type": "Brand", name: "PSH" });
    assert.deepEqual(ld.offers, {
        "@type": "Offer", url: `${SITE}/product/j13`, priceCurrency: "INR", price: "1000.00",
        availability: "https://schema.org/InStock"
    });
    for (const forbidden of ["aggregateRating", "review", "gtin", "gtin13", "mpn", "shippingDetails",
        "hasMerchantReturnPolicy", "priceValidUntil", "itemCondition"]) {
        assert.equal(forbidden in ld, false, forbidden);
        assert.equal(forbidden in ld.offers, false, forbidden);
    }
});

test("availability and prices come from the SKUs: out of stock, price overrides and multiple SKUs", () => {
    const soldOut = buildProductSeo(product(), [variant({ stockOnHand: 1, reserved: 1 })],
        { siteUrl: SITE, brandName: "PSH" });
    assert.equal(soldOut.availability, "OutOfStock");
    assert.equal(soldOut.jsonLd.offers.availability, "https://schema.org/OutOfStock");

    const multi = buildProductSeo(product(), [
        variant({ sku: "A", priceOverridePaise: 120000 }),
        variant({ sku: "B", priceOverridePaise: 90000, stockOnHand: 0 }),
        variant({ sku: "C", active: false })
    ], { siteUrl: SITE, brandName: "PSH" });
    assert.equal(multi.jsonLd.offers.length, 2);
    assert.equal("sku" in multi.jsonLd, false);
    assert.deepEqual(multi.jsonLd.offers.map(offer => [offer.sku, offer.price, offer.availability]), [
        ["A", "1200.00", "https://schema.org/InStock"],
        ["B", "900.00", "https://schema.org/OutOfStock"]
    ]);
    assert.equal(multi.pricePaise, 120000);

    const noVariants = buildProductSeo(product(), [], { siteUrl: SITE, brandName: "PSH" });
    assert.equal(noVariants.availability, null);
    assert.equal("availability" in noVariants.jsonLd.offers, false);
});

test("custom SEO title and description override generated values", () => {
    const seo = buildProductSeo(product({ seo: { title: "Custom title", description: "Custom description" } }),
        [variant()], { siteUrl: SITE, brandName: "PSH" });
    assert.equal(seo.title, "Custom title");
    assert.equal(seo.description, "Custom description");
});

test("crawler HTML carries canonical, Open Graph and Twitter metadata and escapes hostile content", () => {
    const hostile = product({
        name: `Saree "><script>alert(1)</script>`,
        description: `</script><script>alert(2)</script> & more`,
        images: [{ url: IMAGE, role: "primary", altText: `x" onerror="alert(3)` }]
    });
    const seo = buildProductSeo(hostile, [variant()], { siteUrl: SITE, brandName: "PSH" });
    const html = renderProductHtml(seo, { brandName: "PSH", productName: hostile.name });
    for (const expected of [
        `<link rel="canonical" href="${SITE}/product/j13">`,
        `property="og:type" content="product"`, `property="og:url" content="${SITE}/product/j13"`,
        `property="og:title"`, `property="og:description"`, `property="og:image" content="https://res.cloudinary.com/`,
        `name="twitter:card" content="summary_large_image"`, `name="twitter:title"`, `name="twitter:image"`,
        `property="product:price:amount" content="1000.00"`, `property="product:price:currency" content="INR"`,
        `<script type="application/ld+json">`
    ]) assert.ok(html.includes(expected), expected);
    assert.equal(html.includes("<script>alert"), false);
    assert.equal(html.includes(`" onerror="`), false);
    const jsonScripts = html.match(/<script[\s\S]*?<\/script>/g);
    assert.equal(jsonScripts.length, 1);
    const payload = jsonScripts[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    assert.doesNotThrow(() => JSON.parse(payload));
    assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    assert.equal(serializeJsonLd({ a: "</script>" }).includes("</script>"), false);
});

test("crawler HTML omits image tags when the product has no usable image", () => {
    const seo = buildProductSeo(product({ images: [] }), [variant()], { siteUrl: SITE, brandName: "PSH" });
    const html = renderProductHtml(seo, { brandName: "PSH", productName: "Cotton Saree" });
    assert.equal(html.includes("og:image"), false);
    assert.ok(html.includes(`name="twitter:card" content="summary"`));
});

const withServer = async (handlers, run) => {
    const app = express();
    app.get("/sitemap.xml", handlers.sitemap);
    app.get("/sitemaps/:page", handlers.sitemapPage);
    app.get("/seo/product/:productId", handlers.productPreview);
    const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
};

const fakeDeps = (overrides = {}) => {
    const calls = { product: 0, products: 0 };
    return {
        calls,
        deps: {
            getSiteUrl: () => SITE,
            loadSettings: async () => ({ brand: { publicName: "PSH Test" }, policies: { privacy: "Text", terms: "  " } }),
            findPublishedProduct: async identifier => {
                calls.product += 1;
                return identifier === "j13" ? product() : null;
            },
            findActiveVariants: async () => [variant()],
            findPublishedProducts: async () => {
                calls.products += 1;
                return [product(), product({ _id: "64b7f0c2a1b2c3d4e5f60719", slug: "other", collections: [] })];
            },
            ...overrides
        }
    };
};

test("product preview endpoint serves metadata for published products and exposes no private data", async () => {
    const { deps } = fakeDeps();
    await withServer(createSeoHandlers(deps, { cache: createTtlCache() }), async base => {
        const response = await fetch(`${base}/seo/product/J13`);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^text\/html/);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.ok(html.includes("PSH Test"));
        assert.ok(html.includes(`${SITE}/product/j13`));
        for (const secret of ["legacyData", "must never appear", "stockOnHand", "reserved", "mrpPaise", "J13-RED\"" + "x"]) {
            assert.equal(html.includes(secret), false, secret);
        }
    });
});

test("unknown, unpublished and malformed product identifiers return a safe non-indexable 404", async () => {
    const { deps, calls } = fakeDeps();
    await withServer(createSeoHandlers(deps, { cache: createTtlCache() }), async base => {
        const unknown = await fetch(`${base}/seo/product/missing-product`);
        assert.equal(unknown.status, 404);
        assert.equal(unknown.headers.get("x-robots-tag"), "noindex");
        const body = await unknown.text();
        assert.ok(body.includes('content="noindex"'));
        assert.equal(body.includes("og:image"), false);

        const before = calls.product;
        for (const bad of ["..%2F..%2Fetc", "a%20b", "x".repeat(250), "$ne", "a.b"]) {
            const response = await fetch(`${base}/seo/product/${bad}`);
            assert.equal(response.status, 404, bad);
        }
        assert.equal(calls.product, before, "malformed identifiers must not reach the database");
    });
});

test("database failures return 503 with Retry-After, not an empty or misleading page", async () => {
    const { deps } = fakeDeps({ findPublishedProduct: async () => { throw new Error("db down"); } });
    const originalError = console.error;
    console.error = () => {};
    try {
        await withServer(createSeoHandlers(deps, { cache: createTtlCache() }), async base => {
            const response = await fetch(`${base}/seo/product/j13`);
            assert.equal(response.status, 503);
            assert.equal(response.headers.get("retry-after"), "60");
            const sitemap = await createSeoHandlers({ ...deps, findPublishedProducts: async () => { throw new Error("x"); } },
                { cache: createTtlCache() });
            await withServer(sitemap, async inner => {
                const res = await fetch(`${inner}/sitemap.xml`);
                assert.equal(res.status, 503);
                assert.equal(res.headers.get("retry-after"), "300");
            });
        });
    } finally {
        console.error = originalError;
    }
});

test("sitemap lists public pages and published products only, as valid cached XML", async () => {
    const { deps, calls } = fakeDeps();
    await withServer(createSeoHandlers(deps, { cache: createTtlCache() }), async base => {
        const response = await fetch(`${base}/sitemap.xml`);
        const xml = await response.text();
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^application\/xml/);
        assert.match(response.headers.get("cache-control"), /s-maxage=3600/);
        assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
        const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
        assert.equal(new Set(locs).size, locs.length, "no duplicate URLs");
        for (const expected of ["/", "/collection", "/about", "/contact", "/privacy-policy",
            "/category/sarees", "/collections/diwali", "/product/j13", "/product/other"]) {
            assert.ok(locs.includes(`${SITE}${expected}`), expected);
        }
        for (const excluded of ["/terms-and-conditions", "/shipping-policy", "/returns-policy", "/cart",
            "/orders", "/login", "/place-order", "/verify", "/collections/dhanteras"]) {
            assert.equal(locs.includes(`${SITE}${excluded}`), false, excluded);
        }
        assert.ok(locs.every(loc => loc.startsWith(`${SITE}/`) || loc === `${SITE}/`));
        assert.match(xml, /<loc>https:\/\/shop\.example\.test\/product\/j13<\/loc><lastmod>2026-10-01T10:00:00\.000Z<\/lastmod>/);
        await fetch(`${base}/sitemap.xml`);
        assert.equal(calls.products, 1, "second request is served from the cache");
    });
});

test("sitemap query selects published products only and never reads private fields", async () => {
    const original = productModel.find;
    let filter;
    let selected;
    let limited = false;
    productModel.find = f => {
        filter = f;
        const chain = {
            select: fields => { selected = fields; return chain; },
            sort: () => chain,
            limit: () => { limited = true; return chain; },
            lean: async () => []
        };
        return chain;
    };
    try {
        const handlers = createSeoHandlers({ getSiteUrl: () => SITE, loadSettings: async () => null });
        await withServer(handlers, async base => {
            const response = await fetch(`${base}/sitemap.xml`);
            assert.equal(response.status, 200);
        });
        assert.deepEqual(filter, { status: "published" });
        assert.equal(limited, false, "the product query must not silently truncate the catalogue");
        assert.ok(!/legacyData|stock|details/.test(selected));
    } finally {
        productModel.find = original;
    }
});

test("large catalogues are served as a sitemap index that covers every product exactly once", async () => {
    const total = SITEMAP_PAGE_SIZE * 2 + 37;
    const many = Array.from({ length: total }, (_, index) => product({
        _id: `64b7f0c2a1b2c3d4e5${String(index).padStart(6, "0")}`,
        slug: `saree-${index}`,
        collections: [],
        updatedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000)
    }));
    const { deps, calls } = fakeDeps({ findPublishedProducts: async () => { calls.products += 1; return many; } });
    await withServer(createSeoHandlers(deps, { cache: createTtlCache() }), async base => {
        const indexXml = await (await fetch(`${base}/sitemap.xml`)).text();
        assert.match(indexXml, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
        const pages = [...indexXml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
        assert.ok(pages.length >= 3);
        assert.ok(pages.every((loc, index) => loc === `${SITE}/sitemaps/${index + 1}`));

        const seen = [];
        for (let page = 1; page <= pages.length; page += 1) {
            const response = await fetch(`${base}/sitemaps/${page}`);
            assert.equal(response.status, 200);
            const xml = await response.text();
            const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
            assert.ok(locs.length <= SITEMAP_PAGE_SIZE);
            seen.push(...locs);
        }
        assert.equal(new Set(seen).size, seen.length, "no URL appears twice across pages");
        for (let index = 0; index < total; index += 1) {
            assert.ok(seen.includes(`${SITE}/product/saree-${index}`), `product ${index} missing`);
        }
        assert.equal((await fetch(`${base}/sitemaps/${pages.length + 1}`)).status, 404);
        assert.equal((await fetch(`${base}/sitemaps/0`)).status, 404);
        assert.equal((await fetch(`${base}/sitemaps/abc`)).status, 404);
        assert.equal(calls.products, 1, "one database read serves the index and every page");
    });
});

test("small catalogues stay a single sitemap and expose no sub-sitemaps", async () => {
    const { deps } = fakeDeps();
    await withServer(createSeoHandlers(deps, { cache: createTtlCache() }), async base => {
        assert.match(await (await fetch(`${base}/sitemap.xml`)).text(), /<urlset /);
        assert.equal((await fetch(`${base}/sitemaps/1`)).status, 404);
    });
});

test("sitemap index XML is escaped and omits empty lastmod", () => {
    const xml = renderSitemapIndex([{ loc: "https://x.test/a&b", lastmod: "" }]);
    assert.ok(xml.includes("<sitemap><loc>https://x.test/a&amp;b</loc></sitemap>"));
});

test("only absolute https image URLs reach crawler HTML and JSON-LD", () => {
    const hostile = product({
        images: [
            { url: "javascript:alert(1)", role: "primary", order: 0 },
            { url: "http://insecure.test/a.jpg", order: 1 },
            { url: "data:text/html;base64,AAAA", order: 2 },
            { url: "https://user:pw@cdn.test/a.jpg", order: 3 },
            { url: "https://res.cloudinary.com/demo/image/upload/v1/ok.jpg", order: 4 }
        ]
    });
    const seo = buildProductSeo(hostile, [variant()], { siteUrl: SITE, brandName: "PSH" });
    assert.deepEqual(seo.jsonLd.image, ["https://res.cloudinary.com/demo/image/upload/v1/ok.jpg"]);
    assert.match(seo.imageUrl, /^https:\/\/res\.cloudinary\.com\//);
    assert.equal(publicImageUrl("not a url"), "");
    const none = buildProductSeo(product({ images: [{ url: "javascript:alert(1)" }] }), [variant()],
        { siteUrl: SITE, brandName: "PSH" });
    assert.equal(none.imageUrl, "");
    assert.ok(!("image" in none.jsonLd));
});

test("sitemap XML escapes special characters and handles missing dates", () => {
    const xml = renderSitemap(buildSitemapEntries({
        siteUrl: SITE,
        products: [{ _id: "1", slug: "a&b", updatedAt: "not a date", productType: "other", category: "" }]
    }));
    assert.ok(xml.includes("<loc>https://shop.example.test/product/a%26b</loc></url>"));
    assert.equal(xml.includes("<lastmod></lastmod>"), false);
    assert.equal(/&(?!amp;|lt;|gt;|quot;|#39;)/.test(xml), false);
});

test("category slugs are canonical top-level categories only, at most one per product", () => {
    assert.deepEqual([...categorySlugsFor({ productType: "saree", category: "Silk Sarees" })], ["sarees"]);
    assert.deepEqual([...categorySlugsFor({ productType: "suit-piece", category: "Suit Pants" })], ["suit-pieces"]);
    assert.deepEqual([...categorySlugsFor({ productType: "kurti", category: "Kurtis" })], ["kurtis"]);
    assert.deepEqual([...categorySlugsFor({ productType: "lehenga", category: "Lehenga" })], ["lehengas"]);
    assert.deepEqual([...categorySlugsFor({ productType: "other", category: " cotton   SAREES " })], ["sarees"]);
    assert.deepEqual([...categorySlugsFor({ productType: "other", category: "" })], []);
    assert.deepEqual([...categorySlugsFor({ productType: "other", category: "Dupatta" })], []);
    assert.deepEqual([...categorySlugsFor({ productType: "dress", category: "Dresses" })], []);
});

test("sitemap lists only canonical category pages, once each, with no label-derived duplicates", () => {
    const entries = buildSitemapEntries({
        siteUrl: SITE,
        products: [
            { _id: "1", slug: "a", productType: "saree", category: "Silk Sarees", updatedAt: "2026-01-01T00:00:00Z" },
            { _id: "2", slug: "b", productType: "saree", category: "Sarees", updatedAt: "2026-02-01T00:00:00Z" },
            { _id: "3", slug: "c", productType: "suit-piece", category: "Suit Pants", updatedAt: "2026-01-01T00:00:00Z" },
            { _id: "4", slug: "d", productType: "suit", category: "Suit Pieces", updatedAt: "2026-01-01T00:00:00Z" },
            { _id: "5", slug: "e", productType: "lehenga", category: "Lehenga", updatedAt: "2026-01-01T00:00:00Z" },
            { _id: "6", slug: "f", productType: "other", category: "Kurti", updatedAt: "2026-01-01T00:00:00Z" },
            { _id: "7", slug: "g", productType: "other", category: "Dupatta", updatedAt: "2026-01-01T00:00:00Z" }
        ]
    });
    const categoryUrls = entries.map(entry => entry.loc).filter(loc => loc.includes("/category/")).sort();
    assert.deepEqual(categoryUrls, ["sarees", "suit-pieces", "lehengas", "kurtis"].sort().map(slug => `${SITE}/category/${slug}`));
    assert.equal(entries.find(entry => entry.loc === `${SITE}/category/sarees`).lastmod, "2026-02-01T00:00:00.000Z");
});

test("TTL cache expires entries and stays bounded", () => {
    let clock = 0;
    const cache = createTtlCache({ ttlMs: 100, maxEntries: 2, now: () => clock });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.get("c"), 3);
    clock = 101;
    assert.equal(cache.get("c"), undefined);
});
