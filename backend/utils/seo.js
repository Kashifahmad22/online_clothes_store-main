// Pure helpers for crawler-facing HTML, structured data and the sitemap. Nothing here touches
// the database or the network, so every function is directly unit-testable.
import { resolveProductCategory } from "../config/catalogueTaxonomy.js";

const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

export const escapeHtml = value => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const escapeXml = escapeHtml;

export const stripText = value => String(value ?? "").replace(/\s+/g, " ").trim();

export const truncate = (value, max) => value.length <= max
    ? value
    : `${value.slice(0, max - 1).trimEnd()}…`;

// Inserts a Cloudinary transformation unless the URL already carries one or is not Cloudinary.
export const cloudinaryImage = (url, transformation) => {
    const match = CLOUDINARY_UPLOAD.exec(typeof url === "string" ? url : "");
    if (!match) return url;
    const firstSegment = match[2].split("/")[0];
    const alreadyTransformed = !/^v\d+$/.test(firstSegment) &&
        (firstSegment.includes(",") || /^[a-z]{1,3}_/.test(firstSegment));
    return alreadyTransformed ? url : `${match[1]}${transformation}/${match[2]}`;
};

// JSON-LD is embedded in a <script> element, so "<" and line separators must never appear raw.
export const serializeJsonLd = data => JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export const productPath = product => `/product/${encodeURIComponent(product.slug || String(product._id))}`;

export const availableQuantity = variant =>
    Math.max(0, (variant?.stockOnHand || 0) - (variant?.reserved || 0));

// Only absolute https URLs are ever emitted into crawler HTML or structured data.
export const publicImageUrl = value => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : "";
    } catch {
        return "";
    }
};

// Valid images ordered with the primary image first.
const publicImages = images => {
    const sorted = (images || [])
        .map(image => ({ ...image, url: publicImageUrl(image?.url) }))
        .filter(image => image.url)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    const primary = sorted.find(image => image.role === "primary");
    return primary ? [primary, ...sorted.filter(image => image !== primary)] : sorted;
};

const formatPrice = paise => (paise / 100).toFixed(2);

const nonEmptyText = value => typeof value === "string" && value.trim() ? value.trim() : "";

export const buildProductSeo = (product, variants, { siteUrl, brandName }) => {
    const canonicalUrl = `${siteUrl}${productPath(product)}`;
    const activeVariants = (variants || []).filter(variant => variant.active !== false);
    const offers = activeVariants.map(variant => ({
        sku: variant.sku,
        pricePaise: Number.isSafeInteger(variant.priceOverridePaise)
            ? variant.priceOverridePaise
            : product.pricePaise,
        inStock: availableQuantity(variant) > 0
    }));
    const inStockOffers = offers.filter(offer => offer.inStock);
    const pricePool = inStockOffers.length ? inStockOffers : offers;
    const startingPricePaise = pricePool.length
        ? Math.min(...pricePool.map(offer => offer.pricePaise))
        : product.pricePaise;
    const availability = offers.length ? (inStockOffers.length ? "InStock" : "OutOfStock") : null;

    const description = nonEmptyText(product.seo?.description) ||
        truncate(stripText(product.description), 200);
    const title = nonEmptyText(product.seo?.title) || `${product.name} | ${brandName}`;
    const images = publicImages(product.images);
    const image = images[0] || null;
    const imageUrl = image ? cloudinaryImage(image.url, "f_jpg,q_auto,w_1200,h_1200,c_limit") : "";
    const imageAlt = image ? (nonEmptyText(image.altText) || product.name) : "";

    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        url: canonicalUrl,
        ...(description ? { description } : {}),
        ...(images.length ? { image: images.map(item => item.url) } : {}),
        ...(brandName ? { brand: { "@type": "Brand", name: brandName } } : {}),
        ...(nonEmptyText(product.category) ? { category: product.category.trim() } : {}),
        ...(nonEmptyText(product.details?.fabric) ? { material: product.details.fabric.trim() } : {}),
        ...(nonEmptyText(product.details?.colour) ? { color: product.details.colour.trim() } : {}),
        ...(offers.length === 1 ? { sku: offers[0].sku } : {})
    };
    const toOffer = offer => ({
        "@type": "Offer",
        url: canonicalUrl,
        priceCurrency: "INR",
        price: formatPrice(offer.pricePaise),
        availability: `https://schema.org/${offer.inStock ? "InStock" : "OutOfStock"}`,
        ...(offers.length > 1 ? { sku: offer.sku } : {})
    });
    if (offers.length) {
        jsonLd.offers = offers.length === 1 ? toOffer(offers[0]) : offers.map(toOffer);
    } else if (Number.isSafeInteger(product.pricePaise)) {
        jsonLd.offers = {
            "@type": "Offer",
            url: canonicalUrl,
            priceCurrency: "INR",
            price: formatPrice(product.pricePaise)
        };
    }

    return {
        title,
        description,
        canonicalUrl,
        imageUrl,
        imageAlt,
        pricePaise: Number.isSafeInteger(startingPricePaise) ? startingPricePaise : null,
        availability,
        jsonLd
    };
};

const metaTag = (attribute, name, content) =>
    content ? `<meta ${attribute}="${escapeHtml(name)}" content="${escapeHtml(content)}">` : "";

export const renderProductHtml = (seo, { brandName, productName }) => {
    const tags = [
        `<title>${escapeHtml(seo.title)}</title>`,
        metaTag("name", "description", seo.description),
        `<link rel="canonical" href="${escapeHtml(seo.canonicalUrl)}">`,
        metaTag("property", "og:type", "product"),
        metaTag("property", "og:site_name", brandName),
        metaTag("property", "og:locale", "en_IN"),
        metaTag("property", "og:title", seo.title),
        metaTag("property", "og:description", seo.description),
        metaTag("property", "og:url", seo.canonicalUrl),
        metaTag("property", "og:image", seo.imageUrl),
        metaTag("property", "og:image:alt", seo.imageAlt),
        seo.pricePaise === null ? "" : metaTag("property", "product:price:amount", formatPrice(seo.pricePaise)),
        seo.pricePaise === null ? "" : metaTag("property", "product:price:currency", "INR"),
        seo.availability
            ? metaTag("property", "product:availability", seo.availability === "InStock" ? "in stock" : "out of stock")
            : "",
        metaTag("name", "twitter:card", seo.imageUrl ? "summary_large_image" : "summary"),
        metaTag("name", "twitter:title", seo.title),
        metaTag("name", "twitter:description", seo.description),
        metaTag("name", "twitter:image", seo.imageUrl),
        metaTag("name", "twitter:image:alt", seo.imageAlt),
        `<script type="application/ld+json">${serializeJsonLd(seo.jsonLd)}</script>`
    ].filter(Boolean);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${tags.join("\n")}
</head>
<body>
<h1>${escapeHtml(productName)}</h1>
${seo.description ? `<p>${escapeHtml(seo.description)}</p>` : ""}
<p><a href="${escapeHtml(seo.canonicalUrl)}">View this product on ${escapeHtml(brandName)}</a></p>
</body>
</html>
`;
};

// Generic page for unknown or unpublished products: no product data, never indexable.
export const renderUnavailableHtml = ({ siteUrl, brandName }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`Product not available | ${brandName}`)}</title>
<meta name="robots" content="noindex">
</head>
<body>
<h1>This product is not available.</h1>
<p><a href="${escapeHtml(siteUrl)}/collection">Browse ${escapeHtml(brandName)}</a></p>
</body>
</html>
`;

// Campaign slugs mirror frontend/src/config/campaigns.js; keep them in sync.
const CAMPAIGNS = [
    { slug: "dhanteras", tag: "Dhanteras" },
    { slug: "diwali", tag: "Diwali" },
    { slug: "chhath", tag: "Chhath" }
];
export const POLICY_PATHS = {
    privacy: "/privacy-policy",
    terms: "/terms-and-conditions",
    shipping: "/shipping-policy",
    returns: "/returns-policy"
};

// Only canonical top-level category pages are indexable; a product contributes at most one.
export const categorySlugsFor = product => {
    const { category } = resolveProductCategory(product);
    return new Set(category ? [category.slug] : []);
};

const toIso = value => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const latest = (current, candidate) => (!current || candidate > current ? candidate : current);

// Only public, indexable pages. Product records must already be filtered to status "published".
export const buildSitemapEntries = ({ siteUrl, products, policies = {} }) => {
    const entries = new Map();
    const add = (path, lastmod = "") => {
        const loc = `${siteUrl}${path}`;
        const existing = entries.get(loc);
        entries.set(loc, { loc, lastmod: existing?.lastmod ? latest(existing.lastmod, lastmod) : lastmod });
    };

    const categoryDates = new Map();
    const campaignDates = new Map();
    let newest = "";
    for (const product of products) {
        const modified = toIso(product.updatedAt);
        if (modified) newest = latest(newest, modified);
        for (const slug of categorySlugsFor(product)) {
            categoryDates.set(slug, modified ? latest(categoryDates.get(slug), modified) : categoryDates.get(slug) || "");
        }
        for (const campaign of CAMPAIGNS) {
            if ((product.collections || []).includes(campaign.tag)) {
                campaignDates.set(campaign.slug,
                    modified ? latest(campaignDates.get(campaign.slug), modified) : campaignDates.get(campaign.slug) || "");
            }
        }
    }

    add("/", newest);
    add("/collection", newest);
    add("/about");
    add("/contact");
    for (const [key, path] of Object.entries(POLICY_PATHS)) {
        if (nonEmptyText(policies[key])) add(path);
    }
    for (const [slug, modified] of categoryDates) add(`/category/${slug}`, modified);
    for (const [slug, modified] of campaignDates) add(`/collections/${slug}`, modified);
    for (const product of products) {
        if (!product.slug && !product._id) continue;
        add(productPath(product), toIso(product.updatedAt));
    }
    return [...entries.values()];
};

export const renderSitemapIndex = items => `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items.map(item => `  <sitemap><loc>${escapeXml(item.loc)}</loc>${
    item.lastmod ? `<lastmod>${item.lastmod}</lastmod>` : ""}</sitemap>`).join("\n")}
</sitemapindex>
`;

export const latestModified = entries => entries.reduce((newest, entry) => latest(newest, entry.lastmod), "");

export const renderSitemap = entries => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(entry => `  <url><loc>${escapeXml(entry.loc)}</loc>${
    entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
