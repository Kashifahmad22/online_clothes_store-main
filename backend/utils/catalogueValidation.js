import mongoose from "mongoose";
import { isLowStock } from "./merchandising.js";

const invalidInput = message => Object.assign(new Error(message), { status: 400 });
const productTypes = new Set(["saree", "suit-piece", "suit", "suit-set", "dress", "lehenga", "other"]);
const imageRoles = new Set([
    "primary", "full-saree", "border", "pallu", "blouse", "detail", "lifestyle", "other"
]);

export const parseProductPayload = (raw) => {
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
    if (product.mrpPaise !== undefined &&
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
    if (product.status !== undefined && !["draft", "published"].includes(product.status)) {
        throw invalidInput("Product status must be draft or published.");
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
        if (variant.priceOverridePaise !== undefined &&
            (!Number.isSafeInteger(variant.priceOverridePaise) || variant.priceOverridePaise < 0)) {
            throw invalidInput("Variant price must be a non-negative integer amount in paise.");
        }
        if (product.mrpPaise !== undefined &&
            variant.priceOverridePaise !== undefined &&
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
