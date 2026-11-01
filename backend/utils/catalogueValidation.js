import mongoose from "mongoose";
import { isLowStock } from "./merchandising.js";
import { PRODUCT_TYPES } from "../config/catalogueTaxonomy.js";

const invalidInput = message => Object.assign(new Error(message), { status: 400 });
const productTypes = new Set(PRODUCT_TYPES);
const imageRoles = new Set([
    "primary", "full-saree", "border", "pallu", "blouse", "detail", "lifestyle", "other"
]);

// Mirrored in admin/src/utils/productAttributes.js and frontend/src/utils/productDisplay.js; a drift test keeps them equal.
export const PLACEHOLDER_VALUE = /^(?:n\/?a|na|none|null|undefined|nil|tbd|not specified|unknown|-+|\.+)$/i;
export const MAX_ATTRIBUTE_LENGTH = 80;
export const MAX_ALT_TEXT_LENGTH = 160;
const ATTRIBUTE_LABELS = { fabric: "Fabric", colour: "Colour" };

// Trims fabric and colour in place. Both stay optional: blank is allowed, placeholders and non-text are not.
// Every other key in `details` is left exactly as received.
// A value that is unchanged from the stored product (`existing`) is a legacy value: it is kept exactly as stored
// and not re-validated, so an unrelated edit is never blocked by an old placeholder. Changed values are validated.
const tidy = value => value.replace(/\s+/g, " ").trim();
const isUnchangedAttribute = (submitted, stored) =>
    stored !== undefined &&
    (submitted === stored || (typeof submitted === "string" && typeof stored === "string" && tidy(submitted) === tidy(stored)));

export const normaliseDetailAttributes = (details, existing) => {
    if (!details) return details;
    for (const [key, label] of Object.entries(ATTRIBUTE_LABELS)) {
        if (details[key] === undefined) continue;
        if (existing && isUnchangedAttribute(details[key], existing[key])) {
            details[key] = existing[key];
            continue;
        }
        if (details[key] !== null && typeof details[key] !== "string") {
            throw invalidInput(`${label} must be text.`);
        }
        const value = (details[key] ?? "").replace(/\s+/g, " ").trim();
        if (value && PLACEHOLDER_VALUE.test(value)) {
            throw invalidInput(`${label} cannot be a placeholder such as "${value}". Leave it blank if unknown.`);
        }
        if (value.length > MAX_ATTRIBUTE_LENGTH) {
            throw invalidInput(`${label} must be ${MAX_ATTRIBUTE_LENGTH} characters or fewer.`);
        }
        details[key] = value;
    }
    return details;
};

const cleanAltText = (value, position) => {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw invalidInput(`Image ${position} alt text must be text.`);
    const text = value.replace(/\s+/g, " ").trim();
    if (text.length > MAX_ALT_TEXT_LENGTH) {
        throw invalidInput(`Image ${position} alt text must be ${MAX_ALT_TEXT_LENGTH} characters or fewer.`);
    }
    return text;
};

export const parseImageAlts = (raw, fileCount) => {
    if (!raw) return Array.from({ length: fileCount }, () => "");
    let alts;
    try {
        alts = JSON.parse(raw);
    } catch {
        throw invalidInput("Image alt text must be valid JSON.");
    }
    if (!Array.isArray(alts) || alts.length !== fileCount) {
        throw invalidInput("Provide one alt text for each uploaded image.");
    }
    return alts.map((alt, index) => cleanAltText(alt, index + 1));
};

// Final stored order: the submitted order, except that the single primary image is always first.
// `order` is the array index, so ordering is stable after save and reload.
// A newly saved collection must have exactly one primary image.
export const assembleImages = images => {
    const cleaned = images.map((image, index) => ({
        url: image.url,
        role: image.role || "other",
        altText: cleanAltText(image.altText, index + 1)
    }));
    const primaries = cleaned.filter(image => image.role === "primary");
    if (primaries.length > 1) {
        throw invalidInput("Choose only one primary image.");
    }
    if (cleaned.length > 0 && primaries.length === 0) {
        throw invalidInput("Choose one primary image.");
    }
    const ordered = primaries.length ? [primaries[0], ...cleaned.filter(image => image !== primaries[0])] : cleaned;
    return ordered.map((image, order) => ({ ...image, order }));
};

// True when an edit leaves the saved images exactly as stored (same files, roles, alt text and order, no uploads).
// Such a save keeps legacy image metadata untouched instead of re-validating it.
export const imagesUnchanged = (submitted, stored, uploadCount = 0) =>
    uploadCount === 0 &&
    Array.isArray(submitted) && Array.isArray(stored) &&
    submitted.length === stored.length &&
    submitted.every((image, index) =>
        image?.url === stored[index].url &&
        (image.role || "other") === (stored[index].role || "other") &&
        (image.altText || "") === (stored[index].altText || ""));

export const keepStoredImages = stored => stored.map((image, index) => ({
    url: image.url,
    role: image.role || "other",
    altText: typeof image.altText === "string" ? image.altText : "",
    order: Number.isInteger(image.order) ? image.order : index
}));

// `deferAttributes` lets an update validate fabric/colour against the stored product instead (see updateProduct).
export const parseProductPayload = (raw, { deferAttributes = false } = {}) => {
    let product;
    try {
        product = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
        throw invalidInput("Product data must be valid JSON.");
    }

    if (!product || typeof product !== "object" || Array.isArray(product)) {
        throw invalidInput("Product data is required.");
    }
    if (typeof product.name !== "string" || !product.name.trim() ||
        typeof product.description !== "string" || !product.description.trim() ||
        typeof product.category !== "string" || !product.category.trim() ||
        typeof product.productType !== "string") {
        throw invalidInput("Name, description, product type, and category are required.");
    }
    if (!productTypes.has(product.productType)) {
        throw invalidInput("Unsupported product type.");
    }
    if (product.slug !== undefined &&
        (typeof product.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(product.slug))) {
        throw invalidInput("Slug may contain only letters, numbers, and single hyphens.");
    }
    if (!Number.isSafeInteger(product.pricePaise) || product.pricePaise < 0) {
        throw invalidInput("Price must be a non-negative integer amount in paise.");
    }
    if (product.mrpPaise !== undefined && product.mrpPaise !== null &&
        (!Number.isSafeInteger(product.mrpPaise) || product.mrpPaise < product.pricePaise)) {
        throw invalidInput("MRP must be an integer amount in paise and not less than the selling price.");
    }
    if (product.status === "published" &&
        product.productType === "saree" &&
        typeof product.details?.blousePieceIncluded !== "boolean") {
        throw invalidInput("Specify whether the blouse piece is included.");
    }
    if (product.details !== undefined &&
        (!product.details || typeof product.details !== "object" || Array.isArray(product.details))) {
        throw invalidInput("Product details must be a key/value object.");
    }
    if (!deferAttributes) normaliseDetailAttributes(product.details);
    if (product.status !== undefined && !    ["draft", "published", "archived"].includes(product.status)) {
            throw invalidInput("Product status must be draft, published, or archived.");
    }
    if (product.bestseller !== undefined && typeof product.bestseller !== "boolean") {
        throw invalidInput("Bestseller must be true or false.");
    }
    if (product.fastSelling !== undefined && typeof product.fastSelling !== "boolean") {
        throw invalidInput("Fast selling must be true or false.");
    }
    if (product.bestseller === true && product.fastSelling === true) {
        throw invalidInput("Choose either Best Seller or Fast Selling, not both.");
    }
    if (product.subCategory !== undefined && typeof product.subCategory !== "string") {
        throw invalidInput("Subcategory must be text.");
    }
    if (product.collections !== undefined &&
        (!Array.isArray(product.collections) ||
            product.collections.some(collection => typeof collection !== "string"))) {
        throw invalidInput("Collections must be a list of names.");
    }
    if (!Array.isArray(product.variants) || product.variants.length === 0) {
        throw invalidInput("At least one sellable SKU is required.");
    }
    if (product.images !== undefined &&
        (!Array.isArray(product.images) || product.images.some(image =>
            !image || typeof image.url !== "string" || !/^https:\/\//i.test(image.url) ||
            (image.role !== undefined && !imageRoles.has(image.role))))) {
        throw invalidInput("Saved product images must be valid HTTPS URLs.");
    }

    const seenSkus = new Set();
    for (const variant of product.variants) {
        if (typeof variant.sku !== "string" || !variant.sku.trim() ||
            !/^[A-Z0-9][A-Z0-9._-]{1,39}$/i.test(variant.sku.trim())) {
            throw invalidInput("Each variant needs a valid SKU (2-40 letters, numbers, dots, underscores, or hyphens).");
        }
        const sku = variant.sku.trim().toUpperCase();
        if (seenSkus.has(sku)) {
            throw invalidInput("SKUs must be unique within a product.");
        }
        seenSkus.add(sku);
        if (!Number.isSafeInteger(variant.stockOnHand) || variant.stockOnHand < 0) {
            throw invalidInput("Variant stock must be a non-negative whole number.");
        }
        if (variant.priceOverridePaise !== undefined && variant.priceOverridePaise !== null &&
            (!Number.isSafeInteger(variant.priceOverridePaise) || variant.priceOverridePaise < 0)) {
            throw invalidInput("Variant price must be a non-negative integer amount in paise.");
        }
        if (typeof product.mrpPaise === "number" &&
            typeof variant.priceOverridePaise === "number" &&
            variant.priceOverridePaise > product.mrpPaise) {
            throw invalidInput("Variant price cannot exceed the product MRP.");
        }
        if (variant.options !== undefined &&
            (!variant.options || typeof variant.options !== "object" || Array.isArray(variant.options))) {
            throw invalidInput("Variant options must be a key/value object.");
        }
        if (variant.options &&
            Object.entries(variant.options).some(([key, value]) =>
                !key.trim() || typeof value !== "string" || !value.trim())) {
            throw invalidInput("Variant option names and values must be non-empty text.");
        }
        if (variant.lowStockThreshold !== undefined &&
            (!Number.isSafeInteger(variant.lowStockThreshold) || variant.lowStockThreshold < 0)) {
            throw invalidInput("Low-stock threshold must be a non-negative whole number.");
        }
        if (variant.active !== undefined && typeof variant.active !== "boolean") {
            throw invalidInput("Variant active state must be true or false.");
        }
    }

    return product;
};

export const parseImageRoles = (raw, fileCount) => {
    let roles = [];
    if (raw) {
        try {
            roles = JSON.parse(raw);
        } catch {
            throw invalidInput("Image roles must be valid JSON.");
        }
        if (!Array.isArray(roles) || roles.length !== fileCount) {
            throw invalidInput("Provide one image role for each uploaded image.");
        }
    }
    return Array.from({ length: fileCount }, (_, index) => {
        const role = roles[index] || (index === 0 ? "primary" : "other");
        if (!imageRoles.has(role)) {
            throw invalidInput(`Unsupported image role at position ${index + 1}.`);
        }
        return role;
    });
};

export const validatePublishableProduct = (product, images) => {
    if (product.status !== "published") return;
    if (images.length === 0) {
        throw invalidInput("Add at least one product image before publishing.");
    }
    if (!images.some(image => image.role === "primary")) {
        throw invalidInput("Select a primary product image before publishing.");
    }
    if (product.productType === "saree" &&
        typeof product.details?.blousePieceIncluded !== "boolean") {
        throw invalidInput("Specify whether the blouse piece is included before publishing.");
    }
    if (!product.variants.some(variant => variant.active !== false)) {
        throw invalidInput("At least one active SKU is required before publishing.");
    }
};

export const isValidObjectId = value => mongoose.Types.ObjectId.isValid(value);

export const toPublicProduct = (product, variants) => {
    const data = product.toObject ? product.toObject() : product;
    return {
        ...data,
        bestseller: data.bestseller === true,
        fastSelling: data.fastSelling === true,
        lowStock: isLowStock(variants.map(variant => variant.toObject ? variant.toObject() : variant)),
        price: data.pricePaise / 100,
        mrp: data.mrpPaise == null ? null : data.mrpPaise / 100,
        image: (data.images || []).map(image => image.url),
        variants: variants.map(variant => {
            const item = variant.toObject ? variant.toObject() : variant;
            const pricePaise = item.priceOverridePaise ?? data.pricePaise;
            return {
                ...item,
                options: item.options instanceof Map ? Object.fromEntries(item.options) : item.options,
                price: pricePaise / 100
            };
        })
    };
};
