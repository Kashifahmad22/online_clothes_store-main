import fs from "node:fs/promises";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import reviewModel from "../models/reviewModel.js";
import productModel from "../models/productModel.js";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import {
    ReviewError, cleanText, parseRating, parseReviewInput, validateReviewImages, displayNameFor,
    recomputeRatingSummary, findQualifyingOrder, validateModeration, toPublicReview, escapeRegex
} from "../utils/reviews.js";

const FOLDER = "patna-saree-handloom/reviews";
const STATUSES = ["pending", "approved", "rejected", "hidden", "flagged"];
const deps = () => ({ reviewModel, productModel });
const validId = id => typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
const pageParams = query => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 10));
    return { page, limit, skip: (page - 1) * limit };
};
const cleanupFiles = files => Promise.all((files || []).map(file => fs.unlink(file.path).catch(() => {})));

const fail = (res, error, fallback = "Something went wrong. Please try again.") => {
    if (error instanceof ReviewError) return res.status(error.status).json({ success: false, message: error.message });
    console.error("review error:", error?.message);
    return res.status(500).json({ success: false, message: fallback });
};

const findPublishedProduct = async productId => {
    if (!validId(productId)) return null;
    const product = await productModel.findById(productId).select("status ratingSummary name").lean();
    return product && product.status === "published" ? product : null;
};

export const listProductReviews = async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await findPublishedProduct(productId);
        if (!product) return res.status(404).json({ success: false, message: "Product not found." });
        const { page, limit, skip } = pageParams(req.query);
        const filter = { productId, status: "approved" };
        const [reviews, total] = await Promise.all([
            reviewModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            reviewModel.countDocuments(filter)
        ]);
        const summary = product.ratingSummary || { count: 0, average: 0, distribution: [0, 0, 0, 0, 0] };
        return res.json({
            success: true,
            summary,
            reviews: reviews.map(toPublicReview),
            pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
        });
    } catch (error) {
        return fail(res, error);
    }
};

export const getMyReview = async (req, res) => {
    try {
        const { productId } = req.params;
        if (!(await findPublishedProduct(productId))) return res.status(404).json({ success: false, message: "Product not found." });
        const [review, order] = await Promise.all([
            reviewModel.findOne({ productId, userId: req.auth.userId, source: "customer" }).lean(),
            findQualifyingOrder(orderModel, req.auth.userId, productId)
        ]);
        return res.json({
            success: true,
            verifiedEligible: Boolean(order),
            review: review ? { ...toPublicReview(review), status: review.status } : null
        });
    } catch (error) {
        return fail(res, error);
    }
};

export const submitReview = async (req, res) => {
    const files = req.files || [];
    const uploaded = [];
    try {
        const { productId } = req.params;
        const userId = req.auth.userId;
        const product = await findPublishedProduct(productId);
        if (!product) throw new ReviewError("Product not found.", 404);
        const input = parseReviewInput(req.body);
        await validateReviewImages(files);
        if (await reviewModel.exists({ productId, userId, source: "customer" })) {
            throw new ReviewError("You have already reviewed this product.", 409);
        }
        const user = await userModel.findById(userId).select("name").lean();
        if (!user) throw new ReviewError("Please log in again.", 401);
        const order = await findQualifyingOrder(orderModel, userId, productId);

        for (const file of files) {
            const result = await cloudinary.uploader.upload(file.path, { folder: FOLDER, resource_type: "image" });
            uploaded.push({ url: result.secure_url, publicId: result.public_id || "" });
        }
        try {
            const review = await reviewModel.create({
                productId, userId, ...input,
                orderId: order ? String(order._id) : undefined,
                displayName: displayNameFor(user.name),
                images: uploaded,
                status: "pending",
                verifiedPurchase: Boolean(order),
                source: "customer",
                moderation: [{ action: "submitted", to: "pending", actor: "customer" }]
            });
            return res.status(201).json({ success: true, message: "Thank you! Your review will appear once it has been approved.", reviewId: String(review._id) });
        } catch (error) {
            await Promise.all(uploaded.filter(item => item.publicId).map(item => cloudinary.uploader.destroy(item.publicId).catch(() => {})));
            if (error?.code === 11000) throw new ReviewError("You have already reviewed this product.", 409);
            throw error;
        }
    } catch (error) {
        return fail(res, error, "Could not save your review. Please try again.");
    } finally {
        await cleanupFiles(files);
    }
};

// Customers may edit text and rating only. The edit returns to moderation, so published content is always reviewed.
export const updateMyReview = async (req, res) => {
    try {
        const { productId } = req.params;
        const review = await reviewModel.findOne({ productId, userId: req.auth.userId, source: "customer" });
        if (!review) throw new ReviewError("Review not found.", 404);
        const input = parseReviewInput(req.body);
        const wasPublic = review.status === "approved";
        const from = review.status;
        Object.assign(review, input, { status: "pending" });
        review.moderation.push({ action: "edited", from, to: "pending", actor: "customer" });
        await review.save();
        if (wasPublic) await recomputeRatingSummary(productId, deps());
        return res.json({ success: true, message: "Your review was updated and will be re-checked before it appears." });
    } catch (error) {
        return fail(res, error);
    }
};

const adminFilter = async query => {
    const filter = {};
    if (STATUSES.includes(query.status)) filter.status = query.status;
    if (/^[1-5]$/.test(String(query.rating))) filter.rating = Number(query.rating);
    if (["customer", "imported"].includes(query.source)) filter.source = query.source;
    const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
    if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        const products = await productModel.find({ name: rx }).select("_id").limit(50).lean();
        filter.$or = [{ displayName: rx }, { productId: { $in: products.map(item => String(item._id)) } }];
    }
    return filter;
};

const adminShape = (review, productNames = {}) => ({
    ...review,
    _id: String(review._id),
    productName: productNames[review.productId] || ""
});

export const adminListReviews = async (req, res) => {
    try {
        const filter = await adminFilter(req.query);
        const { page, limit, skip } = pageParams(req.query);
        const [reviews, total] = await Promise.all([
            reviewModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            reviewModel.countDocuments(filter)
        ]);
        const ids = [...new Set(reviews.map(review => review.productId))].filter(validId);
        const products = await productModel.find({ _id: { $in: ids } }).select("name").lean();
        const names = Object.fromEntries(products.map(item => [String(item._id), item.name]));
        return res.json({
            success: true,
            reviews: reviews.map(review => adminShape(review, names)),
            pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
        });
    } catch (error) {
        return fail(res, error);
    }
};

export const adminGetReview = async (req, res) => {
    try {
        if (!validId(req.params.id)) throw new ReviewError("Review not found.", 404);
        const review = await reviewModel.findById(req.params.id).lean();
        if (!review) throw new ReviewError("Review not found.", 404);
        const [product, order] = await Promise.all([
            productModel.findById(review.productId).select("name").lean(),
            review.orderId && validId(review.orderId) ? orderModel.findById(review.orderId).select("status paymentStatus paymentMethod createdAt").lean() : null
        ]);
        return res.json({
            success: true,
            review: adminShape(review, { [review.productId]: product?.name || "" }),
            order: order ? { _id: String(order._id), status: order.status, paymentStatus: order.paymentStatus, paymentMethod: order.paymentMethod, createdAt: order.createdAt } : null
        });
    } catch (error) {
        return fail(res, error);
    }
};

export const adminModerateReview = async (req, res) => {
    try {
        if (!validId(req.params.id)) throw new ReviewError("Review not found.", 404);
        const { status, reason } = validateModeration(req.body || {});
        const review = await reviewModel.findById(req.params.id);
        if (!review) throw new ReviewError("Review not found.", 404);
        const from = review.status;
        if (from === status) throw new ReviewError(`Review is already ${status}.`, 409);
        review.status = status;
        review.moderation.push({ action: req.body.action, from, to: status, actor: "admin", reason });
        await review.save();
        if (from === "approved" || status === "approved") await recomputeRatingSummary(review.productId, deps());
        return res.json({ success: true, message: `Review ${status}.`, status });
    } catch (error) {
        return fail(res, error);
    }
};

// Manual entry of genuine offline feedback. Never verified, never carries photos, always flagged as imported.
export const adminImportReview = async (req, res) => {
    try {
        const body = req.body || {};
        if (body.permissionConfirmed !== true) throw new ReviewError("Confirm that the customer gave permission to publish this feedback.");
        const productId = body.productId;
        if (!validId(productId) || !(await productModel.exists({ _id: productId }))) throw new ReviewError("Choose a valid product.");
        const input = parseReviewInput({ rating: body.rating, title: body.title, body: body.body });
        const displayName = cleanText(body.displayName, { max: 60, label: "Display name" });
        if (!displayName) throw new ReviewError("A display name is required.");
        const source = cleanText(body.source, { max: 100, label: "Source" });
        if (!source) throw new ReviewError("Say where this feedback came from.");
        const reviewDate = new Date(body.reviewDate);
        if (Number.isNaN(reviewDate.getTime()) || reviewDate > new Date()) throw new ReviewError("Enter a valid past date.");
        const review = await reviewModel.create({
            productId, ...input, displayName,
            status: "approved", verifiedPurchase: false, source: "imported",
            imported: { source, reviewDate, permissionConfirmed: true, enteredBy: "admin" },
            moderation: [{ action: "imported", to: "approved", actor: "admin", reason: `Imported from ${source}` }]
        });
        await recomputeRatingSummary(productId, deps());
        return res.status(201).json({ success: true, reviewId: String(review._id) });
    } catch (error) {
        return fail(res, error);
    }
};
