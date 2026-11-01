import {
    CANONICAL_CATEGORIES, PRODUCT_TYPES, canonicalCategoryClause, categoryById, findSubCategory, subCategoryClause
} from "../config/catalogueTaxonomy.js";

const productTypes = new Set(PRODUCT_TYPES);
const sortOptions = new Set(["newest", "price-asc", "price-desc"]);

const invalidQuery = message => Object.assign(new Error(message), { status: 400 });

const optionalText = (value, label, maxLength) => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
        throw invalidQuery(`${label} must be a non-empty value of at most ${maxLength} characters.`);
    }
    return value.trim();
};

const positiveInteger = (value, fallback, label, maximum) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        throw invalidQuery(`${label} must be a positive whole number.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > maximum) {
        throw invalidQuery(`${label} cannot exceed ${maximum}.`);
    }
    return parsed;
};

const priceInPaise = (value, label) => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) {
        throw invalidQuery(`${label} must be a non-negative amount with at most two decimal places.`);
    }
    const parsed = Number(value);
    const paise = Math.round(parsed * 100);
    if (!Number.isSafeInteger(paise)) {
        throw invalidQuery(`${label} is outside the supported price range.`);
    }
    return paise;
};

const optionalBoolean = (value, label) => {
    if (value === undefined) return false;
    if (value === "true") return true;
    if (value === "false") return false;
    throw invalidQuery(`${label} must be true or false.`);
};

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactTextFilter = value => ({ $regex: `^${escapeRegex(value)}$`, $options: "i" });

export const parseCatalogueQuery = query => {
    const productType = optionalText(query.productType, "Product type", 40);
    if (productType && !productTypes.has(productType)) {
        throw invalidQuery("Invalid product type filter.");
    }

    const category = optionalText(query.category, "Category", 100);
    const canonicalCategory = optionalText(query.canonicalCategory, "Canonical category", 40);
    if (canonicalCategory && !categoryById(canonicalCategory)) {
        throw invalidQuery(`Canonical category must be one of: ${CANONICAL_CATEGORIES.map(item => item.id).join(", ")}.`);
    }
    const subCategoryLabel = optionalText(query.subCategory, "Subcategory", 60);
    let subCategory;
    if (subCategoryLabel) {
        subCategory = findSubCategory(subCategoryLabel);
        if (!subCategory) throw invalidQuery("Subcategory is not recognised.");
        if (subCategory.categoryId !== canonicalCategory) {
            throw invalidQuery("Subcategory must be used with its parent canonicalCategory.");
        }
    }
    const collection = optionalText(query.collection, "Collection", 100);
    const search = optionalText(query.search, "Search", 100);
    const fabric = optionalText(query.fabric, "Fabric", 100);
    const colour = optionalText(query.colour, "Colour", 100);
    const occasion = optionalText(query.occasion, "Occasion", 100);
    const minPricePaise = priceInPaise(query.minPrice, "Minimum price");
    const maxPricePaise = priceInPaise(query.maxPrice, "Maximum price");
    const availableOnly = optionalBoolean(query.availableOnly, "Availability filter");
    if (minPricePaise !== undefined && maxPricePaise !== undefined &&
        minPricePaise > maxPricePaise) {
        throw invalidQuery("Minimum price cannot be greater than maximum price.");
    }
    const sort = query.sort === undefined ? "newest" : query.sort;
    if (typeof sort !== "string" || !sortOptions.has(sort)) {
        throw invalidQuery("Sort must be newest, price-asc, or price-desc.");
    }

    const page = positiveInteger(query.page, 1, "Page", 1_000_000);
    const limit = positiveInteger(query.limit, 24, "Limit", 60);
    const filter = { status: "published" };
    if (productType) filter.productType = productType;
    if (category) filter.category = category;
    if (canonicalCategory) {
        filter.$and = [canonicalCategoryClause(canonicalCategory)];
        if (subCategory) filter.$and.push(subCategoryClause(subCategory.label));
    }
    if (collection) filter.collections = collection;
    if (fabric) filter["details.fabric"] = exactTextFilter(fabric);
    if (colour) filter["details.colour"] = exactTextFilter(colour);
    if (occasion) filter["details.occasion"] = exactTextFilter(occasion);
    if (search) {
        const searchExpression = { $regex: escapeRegex(search), $options: "i" };
        filter.$or = [
            { name: searchExpression },
            { category: searchExpression },
            { "details.fabric": searchExpression },
            { "details.colour": searchExpression },
            { "details.occasion": searchExpression }
        ];
    }

    const sortBy = sort === "newest"
        ? { createdAt: -1 }
        : { pricePaise: sort === "price-asc" ? 1 : -1, createdAt: -1 };

    return {
        filter,
        sortBy,
        sort,
        page,
        limit,
        minPricePaise,
        maxPricePaise,
        availableOnly,
        skip: (page - 1) * limit
    };
};
