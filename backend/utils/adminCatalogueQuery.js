const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 1000000;
const SORTS = Object.freeze({
    "updatedAt-desc": { updatedAt: -1, _id: -1 },
    "createdAt-desc": { createdAt: -1, _id: -1 }
});
const ALLOWED_PARAMS = new Set(["page", "limit", "sort"]);

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
    return { page, limit, sortKey, sort: { ...SORTS[sortKey] }, skip: (page - 1) * limit };
};

export const buildPagination = ({ page, limit, totalProducts }) => ({
    page,
    limit,
    totalProducts,
    totalPages: Math.ceil(totalProducts / limit)
});

export const isAdminProductId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
