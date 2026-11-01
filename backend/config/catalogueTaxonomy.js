// Single source of truth for the catalogue taxonomy. It is deliberately dependency-free so the Vite
// frontend tests can import it by relative path to detect drift (frontend/tests/canonicalCategoryDrift.test.js).
// The backend models, validation, queries and SEO helpers all derive from this file; the frontend keeps a
// mirror (frontend/src/config/canonicalCategories.js) because it is deployed on its own.

// Every accepted productType. Existing values stay valid; `kurti` is new.
export const PRODUCT_TYPES = Object.freeze([
    "saree", "suit-piece", "suit", "suit-set", "dress", "lehenga", "kurti", "other"
]);

// Customer-facing top-level categories, in display order. Never derived from product records.
export const CANONICAL_CATEGORIES = Object.freeze([
    Object.freeze({ id: "sarees", label: "Sarees", slug: "sarees", status: "available" }),
    Object.freeze({ id: "suit-pieces", label: "Suit Pieces", slug: "suit-pieces", status: "coming-soon" }),
    Object.freeze({ id: "lehengas", label: "Lehengas", slug: "lehengas", status: "coming-soon" }),
    Object.freeze({ id: "kurtis", label: "Kurtis", slug: "kurtis", status: "coming-soon" })
]);

export const CATEGORY_MAPPING_STATUS = Object.freeze({
    MAPPED: "mapped",
    // `other` is legacy/unclassified; no category is invented for it.
    UNCLASSIFIED: "unclassified",
    // `dress` has no approved mapping yet; this is an open business decision.
    UNRESOLVED: "unresolved"
});

const TYPE_TO_CATEGORY = Object.freeze({
    saree: "sarees",
    "suit-piece": "suit-pieces",
    suit: "suit-pieces",
    "suit-set": "suit-pieces",
    lehenga: "lehengas",
    kurti: "kurtis"
});

export const categoryById = id => CANONICAL_CATEGORIES.find(category => category.id === id) || null;

// Canonical top-level category for a product type. Free-text category labels never influence this.
export const categoryForProductType = productType => {
    const categoryId = Object.hasOwn(TYPE_TO_CATEGORY, productType) ? TYPE_TO_CATEGORY[productType] : null;
    if (categoryId) return { status: CATEGORY_MAPPING_STATUS.MAPPED, category: categoryById(categoryId) };
    if (productType === "other") return { status: CATEGORY_MAPPING_STATUS.UNCLASSIFIED, category: null };
    // `dress` and any unknown type stay unresolved (dress is an open business decision).
    return { status: CATEGORY_MAPPING_STATUS.UNRESOLVED, category: null };
};

// Legacy free-text labels. A label maps to a top-level category and, where it is narrower than the
// category, to a subcategory. Keys are normalised (lower case, single spaces).
const LABEL_ALIASES = Object.freeze({
    saree: { categoryId: "sarees", subCategory: null },
    sarees: { categoryId: "sarees", subCategory: null },
    "silk sarees": { categoryId: "sarees", subCategory: "Silk Sarees" },
    "cotton sarees": { categoryId: "sarees", subCategory: "Cotton Sarees" },
    "suit piece": { categoryId: "suit-pieces", subCategory: null },
    "suit pieces": { categoryId: "suit-pieces", subCategory: null },
    "suit pants": { categoryId: "suit-pieces", subCategory: "Suit Pants" },
    lehenga: { categoryId: "lehengas", subCategory: null },
    lehengas: { categoryId: "lehengas", subCategory: null },
    kurti: { categoryId: "kurtis", subCategory: null },
    kurtis: { categoryId: "kurtis", subCategory: null }
});

// Recognised subcategories (labels narrower than their parent category), derived from the alias table.
export const SUBCATEGORIES = Object.freeze(Object.values(LABEL_ALIASES)
    .filter(alias => alias.subCategory)
    .map(alias => Object.freeze({ label: alias.subCategory, categoryId: alias.categoryId })));

export const normalizeLabelKey = value =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";

// Product types that map straight to a category. Only `other` may fall back to its legacy label;
// `dress` stays unresolved until a separate business decision.
export const LEGACY_LABEL_FALLBACK_TYPES = Object.freeze(["other"]);
export const typesForCategory = categoryId =>
    PRODUCT_TYPES.filter(type => Object.hasOwn(TYPE_TO_CATEGORY, type) && TYPE_TO_CATEGORY[type] === categoryId);


// Normalised legacy labels that identify a category (including subcategory labels such as "suit pants").
export const aliasKeysForCategory = categoryId =>
    Object.entries(LABEL_ALIASES).filter(([, alias]) => alias.categoryId === categoryId).map(([key]) => key);

// Pure and read-only. The raw input is always returned untouched so later migration work can keep it.
// Unknown labels are reported as unmapped, never forced into a category.
export const normalizeCategoryLabel = raw => {
    const key = normalizeLabelKey(raw);
    const alias = key && Object.hasOwn(LABEL_ALIASES, key) ? LABEL_ALIASES[key] : null;
    if (!alias) return { raw, mapped: false, category: null, subCategory: null };
    return { raw, mapped: true, category: categoryById(alias.categoryId), subCategory: alias.subCategory };
};

// Resolves a product to at most one top-level category. Precedence: a known productType always wins;
// the legacy label is consulted only for `other`. `dress` and unknown types never resolve through a label. A label
// that disagrees with the type is reported as `conflict` and never overrides it. subCategory is kept.
export const resolveProductCategory = (product = {}) => {
    const rawCategory = typeof product.category === "string" ? product.category : "";
    const storedSubCategory = typeof product.subCategory === "string" ? product.subCategory.trim() : "";
    const byType = categoryForProductType(product.productType);
    const label = normalizeCategoryLabel(rawCategory);
    if (byType.status === CATEGORY_MAPPING_STATUS.MAPPED) {
        const conflict = label.mapped && label.category.id !== byType.category.id;
        return {
            category: byType.category,
            source: "productType",
            status: CATEGORY_MAPPING_STATUS.MAPPED,
            subCategory: storedSubCategory || (label.mapped && !conflict ? label.subCategory : null),
            rawCategory,
            conflict
        };
    }
    if (label.mapped && LEGACY_LABEL_FALLBACK_TYPES.includes(product.productType)) {
        return {
            category: label.category,
            source: "label",
            status: CATEGORY_MAPPING_STATUS.MAPPED,
            subCategory: storedSubCategory || label.subCategory,
            rawCategory,
            conflict: false
        };
    }
    return {
        category: null,
        source: null,
        status: byType.status,
        subCategory: storedSubCategory || null,
        rawCategory,
        conflict: false
    };
};

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// JavaScript's \s (and trim()) treat NBSP and other Unicode spaces as whitespace, but MongoDB's PCRE \s is
// ASCII-only. The literal characters below mirror JS whitespace exactly, so the generated query agrees with
// normalizeLabelKey(). Whether MongoDB honours them at runtime is not verified by any test here.
const WS = "[ \t\n\u000b\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]";
const spacedPattern = key => key.split(" ").map(escapeRegex).join(`${WS}+`);

// Mongo clause matching exactly the products resolveProductCategory() assigns to this category:
// the mapped types, plus `other` products whose legacy label is an alias. Case and whitespace
// tolerant, and a single clause so a product can never appear twice.
export const canonicalCategoryClause = categoryId => {
    const aliasPattern = aliasKeysForCategory(categoryId).map(spacedPattern).join("|");
    return {
        $or: [
            { productType: { $in: typesForCategory(categoryId) } },
            {
                productType: { $in: [...LEGACY_LABEL_FALLBACK_TYPES] },
                category: { $regex: `^${WS}*(?:${aliasPattern})${WS}*$`, $options: "i" }
            }
        ]
    };
};

const labelPattern = key => `^${WS}*${spacedPattern(key)}${WS}*$`;

// Narrows a canonical category to one recognised subcategory (case and whitespace tolerant). Always used
// together with canonicalCategoryClause, so the parent category constraint still applies.
// Precedence, so a product resolves to at most one subcategory:
//   1. a stored `subCategory` that is a recognised subcategory wins;
//   2. otherwise the legacy `category` label decides, if it is a recognised subcategory alias.
// An unrecognised stored subCategory (e.g. "Banarasi") never overrides the label.
export const subCategoryClause = subCategoryLabel => {
    const key = normalizeLabelKey(subCategoryLabel);
    const pattern = labelPattern(key);
    const others = SUBCATEGORIES
        .filter(item => normalizeLabelKey(item.label) !== key)
        .map(item => ({ subCategory: { $regex: labelPattern(normalizeLabelKey(item.label)), $options: "i" } }));
    return {
        $or: [
            { subCategory: { $regex: pattern, $options: "i" } },
            { $and: [{ category: { $regex: pattern, $options: "i" } }, { $nor: others }] }
        ]
    };
};

export const findSubCategory = label => {
    const key = normalizeLabelKey(label);
    return key ? SUBCATEGORIES.find(item => normalizeLabelKey(item.label) === key) || null : null;
};
