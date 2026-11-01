import fs from "node:fs/promises";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import {
    isValidObjectId,
    parseImageRoles,
    parseProductPayload,
    toPublicProduct,
    validatePublishableProduct
} from "../utils/catalogueValidation.js";
import { parseCatalogueQuery } from "../utils/catalogueQuery.js";
import { resolveBadgeFlags } from "../utils/merchandising.js";
import { buildStockAdjustment, parseStockAdjustment, toStockSummary } from "../utils/stockAdjustment.js";
import { assertStatusTransition, resolveStatusForEdit } from "../utils/productStatus.js";
import { planVariantChanges } from "../utils/variantPlan.js";
import { buildProductUpdate } from "../utils/productUpdate.js";

const respondError = (res, error) => {
    if (error.status) {
        return res.status(error.status).json({ success: false, message: error.message });
    }
    if (error.code === 11000) {
        return res.status(409).json({ success: false, message: "A product slug or SKU already exists." });
    }
    if (error.name === "ValidationError" || error instanceof SyntaxError) {
        return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Product request failed:", {
        name: typeof error.name === "string" ? error.name : "Error",
        code: typeof error.code === "string" || Number.isSafeInteger(error.code)
            ? String(error.code).slice(0, 80)
            : undefined
    });
    return res.status(500).json({ success: false, message: "Unable to complete the product request." });
};

const uploadImages = async (files, rawRoles) => {
    const roles = parseImageRoles(rawRoles, files.length);
    return Promise.all(files.map(async (file, index) => {
        const result = await cloudinary.uploader.upload(file.path, {
            resource_type: "image",
            folder: "patna-saree-handloom/products"
        });
        return {
            url: result.secure_url,
            role: roles[index],
            altText: "",
            order: index
        };
    }));
};

const clearTempFiles = async (files = []) => {
    await Promise.all(files.map(file => fs.unlink(file.path).catch(error => {
        if (error.code !== "ENOENT") {
            console.error("Failed to remove temporary upload:", { name: error.name || "Error" });
        }
    })));
};

const applyVariantPlan = async (product, plan, session) => {
    for (const change of plan.updates) {
        const update = {};
        if (Object.keys(change.set).length > 0) update.$set = change.set;
        if (Object.keys(change.unset).length > 0) update.$unset = change.unset;
        if (Object.keys(update).length === 0) continue;
        await productVariantModel.updateOne({ _id: change.id }, update, { session });
    }
    for (const data of plan.creates) {
        await productVariantModel.create([{ ...data, productId: product._id }], { session });
    }
};

const attachVariants = async (product, variants, session) => {
    const docs = await productVariantModel.find({ productId: product._id }).session(session);
    await applyVariantPlan(product, planVariantChanges(docs, variants), session);
};

const createSlug = value => value.trim().toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const generatedSlug = value => {
    const base = createSlug(value) || "product";
    return `${base}-${new mongoose.Types.ObjectId().toString().slice(-8)}`;
};

const getProductsWithVariants = async (products, includeInactive = false) => {
    const ids = products.map(product => product._id);
    const variantQuery = { productId: { $in: ids } };
    if (!includeInactive) variantQuery.active = true;
    const variants = await productVariantModel.find(variantQuery).sort({ createdAt: 1 });
    const byProduct = new Map();
    for (const variant of variants) {
        const key = variant.productId.toString();
        byProduct.set(key, [...(byProduct.get(key) || []), variant]);
    }
    return products.map(product =>
        toPublicProduct(product, byProduct.get(product._id.toString()) || [])
    );
};

const addProduct = async (req, res) => {
    const files = req.files || [];
    try {
        const payload = parseProductPayload(req.body.product);
        if (payload.status === "archived") {
            return res.status(400).json({ success: false, message: "A new product cannot be created as archived." });
        }
        const uploadedImages = await uploadImages(files, req.body.imageRoles);
        const images = [...(payload.images || []), ...uploadedImages]
            .map((image, index) => ({
                url: image.url,
                role: image.role,
                altText: image.altText || "",
                order: index
            }));
        if (images.length > 12) {
            return res.status(400).json({ success: false, message: "A product can have up to 12 images." });
        }
        if (images.length === 0) {
            return res.status(400).json({ success: false, message: "At least one product image is required." });
        }
        validatePublishableProduct(payload, images);

        const session = await productModel.startSession();
        let product;
        try {
            await session.withTransaction(async () => {
                [product] = await productModel.create([{
                    name: payload.name.trim(),
                    slug: payload.slug?.trim().toLowerCase() || generatedSlug(payload.name),
                    description: payload.description.trim(),
                    productType: payload.productType,
                    category: payload.category.trim(),
                    subCategory: payload.subCategory || "",
                    collections: payload.collections || [],
                    pricePaise: payload.pricePaise,
                    mrpPaise: payload.mrpPaise ?? undefined,
                    images,
                    details: payload.details || {},
                    status: payload.status === "published" ? "published" : "draft",
                    ...resolveBadgeFlags(payload),
                    seo: payload.seo || {}
                }], { session });
                await attachVariants(product, payload.variants, session);
            });
        } finally {
            await session.endSession();
        }
        const variants = await productVariantModel.find({ productId: product._id });
        return res.status(201).json({ success: true, product: toPublicProduct(product, variants) });
    } catch (error) {
        return respondError(res, error);
    } finally {
        await clearTempFiles(files);
    }
};

const updateProduct = async (req, res) => {
    const files = req.files || [];
    try {
        if (!isValidObjectId(req.params.productId)) {
            return res.status(400).json({ success: false, message: "Invalid product ID." });
        }
        const payload = parseProductPayload(req.body.product);
        const uploadedImages = await uploadImages(files, req.body.imageRoles);
        const product = await productModel.findById(req.params.productId);
        if (!product) return res.status(404).json({ success: false, message: "Product not found." });

        const retainedImages = Array.isArray(payload.images) ? payload.images : product.images;
        const images = [...retainedImages, ...uploadedImages].map((image, index) => ({
            url: image.url,
            role: image.role || "other",
            altText: image.altText || "",
            order: index
        }));
        if (images.length > 12) {
            return res.status(400).json({ success: false, message: "A product can have up to 12 images." });
        }
        if (images.length === 0) {
            return res.status(400).json({ success: false, message: "At least one product image is required." });
        }
        const status = resolveStatusForEdit(product.status, payload.status);
        const existingVariants = await productVariantModel.find({ productId: product._id });
        const plan = planVariantChanges(existingVariants, payload.variants);
        validatePublishableProduct(
            { ...payload, status, variants: plan.activeCount > 0 ? [{ active: true }] : [] },
            images
        );

        const session = await productModel.startSession();
        try {
            await session.withTransaction(async () => {
                await productModel.updateOne(
                    { _id: product._id },
                    buildProductUpdate({ payload, product, images, status }),
                    { runValidators: true, session }
                );
                await applyVariantPlan(product, plan, session);
            });
        } finally {
            await session.endSession();
        }
        const updated = await productModel.findById(product._id);
        const variants = await productVariantModel.find({ productId: product._id });
        return res.json({ success: true, product: toPublicProduct(updated, variants) });
    } catch (error) {
        return respondError(res, error);
    } finally {
        await clearTempFiles(files);
    }
};

const listProducts = async (req, res) => {
    try {
        const catalogueQuery = parseCatalogueQuery(req.query);
        const requiresVariantFiltering = catalogueQuery.sort !== "newest" ||
            catalogueQuery.minPricePaise !== undefined ||
            catalogueQuery.maxPricePaise !== undefined ||
            catalogueQuery.availableOnly;
        let products;
        let total;

        if (requiresVariantFiltering) {
            const priceFilter = {};
            if (catalogueQuery.minPricePaise !== undefined) priceFilter.$gte = catalogueQuery.minPricePaise;
            if (catalogueQuery.maxPricePaise !== undefined) priceFilter.$lte = catalogueQuery.maxPricePaise;
            const matchAfterVariants = [];
            if (Object.keys(priceFilter).length) matchAfterVariants.push({ cataloguePricePaise: priceFilter });
            if (catalogueQuery.availableOnly) matchAfterVariants.push({ availableVariantCount: { $gt: 0 } });

            const [result] = await productModel.aggregate([
                { $match: catalogueQuery.filter },
                {
                    $lookup: {
                        from: productVariantModel.collection.name,
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
                            {
                                $project: {
                                    _id: 0,
                                    pricePaise: { $ifNull: ["$priceOverridePaise", "$$basePrice"] }
                                }
                            }
                        ],
                        as: "availableVariantPrices"
                    }
                },
                {
                    $addFields: {
                        cataloguePricePaise: {
                            $ifNull: [
                                { $min: "$availableVariantPrices.pricePaise" },
                                "$pricePaise"
                            ]
                        },
                        availableVariantCount: { $size: "$availableVariantPrices" }
                    }
                },
                ...(matchAfterVariants.length ? [{ $match: { $and: matchAfterVariants } }] : []),
                {
                    $facet: {
                        products: [
                            { $sort: catalogueQuery.sort === "newest"
                                ? catalogueQuery.sortBy
                                : { cataloguePricePaise: catalogueQuery.sortBy.pricePaise, _id: 1 } },
                            { $skip: catalogueQuery.skip },
                            { $limit: catalogueQuery.limit },
                            { $project: { availableVariantPrices: 0, cataloguePricePaise: 0, availableVariantCount: 0 } }
                        ],
                        count: [{ $count: "total" }]
                    }
                }
            ]);
            products = result?.products || [];
            total = result?.count?.[0]?.total || 0;
        } else {
            [products, total] = await Promise.all([
                productModel.find(catalogueQuery.filter)
                    .sort(catalogueQuery.sortBy)
                    .skip(catalogueQuery.skip)
                    .limit(catalogueQuery.limit),
                productModel.countDocuments(catalogueQuery.filter)
            ]);
        }
        return res.json({
            success: true,
            products: await getProductsWithVariants(products),
            pagination: {
                page: catalogueQuery.page,
                limit: catalogueQuery.limit,
                total,
                pages: Math.ceil(total / catalogueQuery.limit)
            }
        });
    } catch (error) {
        return respondError(res, error);
    }
};

const listCatalogueFacets = async (req, res) => {
    try {
        const published = { status: "published" };
        const fields = {
            categories: "category",
            productTypes: "productType",
            fabrics: "details.fabric",
            colours: "details.colour",
            occasions: "details.occasion"
        };
        const facets = await Promise.all(Object.entries(fields).map(async ([key, field]) => {
            const values = await productModel.distinct(field, published);
            return [key, values
                .filter(value => typeof value === "string" && value.trim())
                .map(value => value.trim())
                .sort((left, right) => left.localeCompare(right))];
        }));
        return res.json({ success: true, facets: Object.fromEntries(facets) });
    } catch (error) {
        return respondError(res, error);
    }
};

const listAdminProducts = async (req, res) => {
    try {
        const products = await productModel.find({}).sort({ updatedAt: -1 });
        return res.json({
            success: true,
            products: await getProductsWithVariants(products, true)
        });
    } catch (error) {
        return respondError(res, error);
    }
};

const singleProduct = async (req, res) => {
    try {
        const product = isValidObjectId(req.params.productId)
            ? await productModel.findOne({ _id: req.params.productId, status: "published" })
            : await productModel.findOne({ slug: req.params.productId, status: "published" });
        if (!product) return res.status(404).json({ success: false, message: "Product not found." });
        const variants = await productVariantModel.find({ productId: product._id, active: true });
        return res.json({ success: true, product: toPublicProduct(product, variants) });
    } catch (error) {
        return respondError(res, error);
    }
};

const updateProductStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!isValidObjectId(req.params.productId) ||
            !["draft", "published", "archived"].includes(status)) {
            return res.status(400).json({ success: false, message: "A valid product ID and status are required." });
        }
        const current = await productModel.findById(req.params.productId);
        if (!current) return res.status(404).json({ success: false, message: "Product not found." });
        assertStatusTransition(current.status, status);
        if (status === "published" && current.status !== "published") {
            if (!Array.isArray(current.images) || current.images.length === 0) {
                return res.status(400).json({ success: false, message: "Add at least one product image before publishing." });
            }
            if (!current.images.some(image => image.role === "primary")) {
                return res.status(400).json({ success: false, message: "Select a primary product image before publishing." });
            }
            if (current.productType === "saree" &&
                typeof current.details?.blousePieceIncluded !== "boolean") {
                return res.status(400).json({ success: false, message: "Specify whether the blouse piece is included before publishing." });
            }
            const activeVariant = await productVariantModel.exists({
                productId: current._id,
                active: true
            });
            if (!activeVariant) {
                return res.status(400).json({ success: false, message: "Add at least one active SKU before publishing." });
            }
        }
        const product = await productModel.findByIdAndUpdate(
            req.params.productId,
            { $set: { status } },
            { new: true, runValidators: true }
        );
        if (!product) return res.status(404).json({ success: false, message: "Product not found." });
        return res.json({ success: true, message: "Product status updated." });
    } catch (error) {
        return respondError(res, error);
    }
};

const adjustStock = async (req, res) => {
    try {
        const { productId, variantId } = req.params;
        if (!isValidObjectId(productId) || !isValidObjectId(variantId)) {
            return res.status(400).json({ success: false, message: "Invalid product or variant ID." });
        }
        const { operation, delta, reason } = parseStockAdjustment(req.body);
        const { filter, update } = buildStockAdjustment(productId, variantId, delta);
        const updated = await productVariantModel.findOneAndUpdate(filter, update, { new: true });
        if (!updated) {
            const exists = await productVariantModel.findOne({ _id: variantId, productId });
            if (!exists) return res.status(404).json({ success: false, message: "Variant not found." });
            return res.status(409).json({
                success: false,
                message: delta < 0
                    ? "Stock cannot be reduced below the quantity reserved for pending payments."
                    : "Stock on hand would exceed the supported maximum."
            });
        }
        console.info("[stock-adjustment]", JSON.stringify({
            productId, sku: updated.sku, operation, delta, reason, at: new Date().toISOString()
        }));
        return res.json({ success: true, message: "Stock updated.", variant: toStockSummary(updated) });
    } catch (error) {
        return respondError(res, error);
    }
};

export { addProduct, adjustStock, listProducts, listCatalogueFacets, listAdminProducts, singleProduct, updateProduct, updateProductStatus };
