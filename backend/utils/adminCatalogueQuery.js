import { PRODUCT_TYPES } from "../config/catalogueTaxonomy.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 1000000;
const MAX_SEARCH_LENGTH = 80;
const MAX_CATEGORY_LENGTH = 100;

// Every sort ends with _id so pages are stable. name-asc needs a case-insensitive collation.
const SORTS = Object.freeze({
    "updatedAt-desc": { sort: { updatedAt: -1, _id: -1 } },
    "createdAt-desc": { sort: { createdAt: -1, _id: -1 } },
    "name-asc": { sort: { name: 1, _id: 1 }, collation: { locale: "en", strength: 2 } },
    // Price sorts order by the storefront's "from" price (see buildAdminPricePipeline), not the base price.
    "price-asc": { sort: { startingPricePaise: 1, _id: 1 } },
    "price-desc": { sort: { startingPricePaise: -1, _id: 1 } }
});

export const isPriceSort = sortKey => sortKey === "price-asc" || sortKey === "price-desc";

// Mirrors the public listing: lowest price among active variants with available stock, where a variant
// without an override uses the base price, falling back to the base price when none is purchasable.
// Returns only the ordered ids of the requested page.
export const buildAdminPricePipeline = (filter, query, variantCollection) => [
    { $match: filter },
    {
        $lookup: {
            from: variantCollection,
            let: { parentId: "$_id", basePrice: "$pricePaise" },
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $and: [
                                { $eq: ["$productId", "$$parentId"] },
                                { $eq: ["$active", true] },
                                { $gt: ["$stockOnHand", { $ifNull: ["$reserved", 0] }] }
                            ]
                        }
                    }
                },
                { $project: { _id: 0, pricePaise: { $ifNull: ["$priceOverridePaise", "$$basePrice"] } } }
            ],
            as: "purchasablePrices"
        }
    },
    { $addFields: { startingPricePaise: { $ifNull: [{ $min: "$purchasablePrices.pricePaise" }, "$pricePaise"] } } },
    { $sort: { ...query.sort } },
    { $skip: query.skip },
    { $limit: query.limit },
    { $project: { _id: 1 } }
];
export const ADMIN_STATUSES = Object.freeze(["published", "draft", "archived"]);
export const ADMIN_PRODUCT_TYPES = PRODUCT_TYPES;
export const ADMIN_STOCK_STATES = Object.freeze(["in-stock", "low-stock", "out-of-stock"]);
export const ADMIN_BADGES = Object.freeze(["bestseller", "fastSelling", "none"]);
const ALLOWED_PARAMS = new Set(["page", "limit", "sort", "search", "status", "category", "productType", "stock", "badge"]);

const queryError = message => Object.assign(new Error(message), { status: 400 });

const parsePositiveInteger = (raw, name, max, fallback) => {
    if (raw === undefined) return fallback;
    if (typeof raw !== "string" || !/^[1-9]\d{0,9}$/.test(raw)) {
        throw queryError(`${name} must be a positive whole number.`);
    }
    const value = Number(raw);
    if (value > max) throw queryError(`${name} must not exceed ${max}.`);
    return value;
};

const parseChoice = (raw, name, allowed) => {
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || !allowed.includes(raw)) {
        throw queryError(`${name} must be one of: ${allowed.join(", ")}.`);
    }
    return raw;
};

const parseText = (raw, name, maxLength) => {
    if (raw === undefined) return undefined;
    if (typeof raw !== "string") throw queryError(`${name} must be text.`);
    const value = raw.trim();
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) throw queryError(`${name} contains invalid characters.`);
    if (value.length > maxLength) throw queryError(`${name} must be at most ${maxLength} characters.`);
    return value === "" ? undefined : value;
};

export const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const parseAdminCatalogueQuery = (query = {}) => {
    for (const key of Object.keys(query)) {
        if (!ALLOWED_PARAMS.has(key)) throw queryError(`Unsupported query parameter: ${key.slice(0, 40)}.`);
    }
    const sortKey = query.sort === undefined ? "updatedAt-desc" : query.sort;
    if (typeof sortKey !== "string" || !Object.hasOwn(SORTS, sortKey)) {
        throw queryError(`sort must be one of: ${Object.keys(SORTS).join(", ")}.`);
    }
    const page = parsePositiveInteger(query.page, "page", MAX_PAGE, 1);
    const limit = parsePositiveInteger(query.limit, "limit", MAX_LIMIT, DEFAULT_LIMIT);
    const { sort, collation } = SORTS[sortKey];
    return {
        page,
        limit,
        sortKey,
        sort: { ...sort },
        collation: collation ? { ...collation } : undefined,
        skip: (page - 1) * limit,
        search: parseText(query.search, "search", MAX_SEARCH_LENGTH),
        status: parseChoice(query.status, "status", ADMIN_STATUSES),
        category: parseText(query.category, "category", MAX_CATEGORY_LENGTH),
        productType: parseChoice(query.productType, "productType", ADMIN_PRODUCT_TYPES),
        stock: parseChoice(query.stock, "stock", ADMIN_STOCK_STATES),
        badge: parseChoice(query.badge, "badge", ADMIN_BADGES)
    };
};

export const searchPattern = search => new RegExp(escapeRegex(search), "i");

// Product-level filter. All conditions are ANDed. skuProductIds are the products with a matching variant SKU.
// Stock state is applied separately because it depends on variants.
export const buildAdminProductFilter = (query, skuProductIds = []) => {
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.productType) filter.productType = query.productType;
    if (query.badge === "bestseller") filter.bestseller = true;
    if (query.badge === "fastSelling") filter.fastSelling = true;
    if (query.badge === "none") {
        filter.bestseller = { $ne: true };
        filter.fastSelling = { $ne: true };
    }
    if (query.search) {
        const pattern = searchPattern(query.search);
        filter.$or = [
            { name: pattern },
            { category: pattern },
            { productType: pattern },
            { _id: { $in: skuProductIds } }
        ];
    }
    return filter;
};

// Ids of the candidate products whose stock state matches, given only their active variants.
export const filterIdsByStockState = (productIds, activeVariants, state, classify) => {
    const byProduct = new Map();
    for (const variant of activeVariants) {
        const key = String(variant.productId);
        byProduct.set(key, [...(byProduct.get(key) || []), variant]);
    }
    return productIds.filter(id => classify(byProduct.get(String(id)) || []) === state);
};

export const buildPagination = ({ page, limit, totalProducts }) => ({
    page,
    limit,
    totalProducts,
    totalPages: Math.ceil(totalProducts / limit)
});

export const isAdminProductId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
