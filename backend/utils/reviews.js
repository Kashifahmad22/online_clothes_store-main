import fs from "node:fs/promises";

export const MAX_REVIEW_IMAGES = 4;
export const MAX_REVIEW_IMAGE_BYTES = 5 * 1024 * 1024;
export const REVIEW_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MODERATION_ACTIONS = Object.freeze({ approve: "approved", reject: "rejected", hide: "hidden", flag: "flagged" });
const REASON_REQUIRED = new Set(["reject", "hide", "flag"]);

export class ReviewError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

// Reviews are plain text. Tags and control characters are removed; React escapes the rest on display.
export const cleanText = (value, { max, multiline = false, label }) => {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new ReviewError(`${label} must be text.`);
    let text = value.replace(/<[^>]*>?/g, " ").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    text = multiline
        ? text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
        : text.replace(/\s+/g, " ").trim();
    if (text.length > max) throw new ReviewError(`${label} must be ${max} characters or fewer.`);
    return text;
};

export const parseRating = value => {
    const rating = typeof value === "string" && /^[1-5]$/.test(value.trim()) ? Number(value) : value;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ReviewError("Choose a rating from 1 to 5 stars.");
    return rating;
};

export const parseReviewInput = (input = {}) => {
    const rating = parseRating(input.rating);
    const title = cleanText(input.title, { max: 100, label: "Title" });
    const body = cleanText(input.body, { max: 2000, multiline: true, label: "Review" });
    if (!body) throw new ReviewError("Please write a few words about the product.");
    return { rating, title, body };
};

const startsWith = (buffer, bytes, offset = 0) => bytes.every((byte, index) => buffer[offset + index] === byte);

// Checks the real file signature, not just the client-declared type.
export const detectImageType = buffer => {
    if (buffer.length >= 3 && startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (buffer.length >= 8 && startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
    if (buffer.length >= 12 && startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
    return null;
};

export const validateReviewImages = async (files = [], readHead = async path => {
    const handle = await fs.open(path, "r");
    try {
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(12), 0, 12, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}) => {
    if (files.length > MAX_REVIEW_IMAGES) throw new ReviewError(`You can add up to ${MAX_REVIEW_IMAGES} photos.`);
    for (const file of files) {
        if (!REVIEW_IMAGE_TYPES.has(file.mimetype)) throw new ReviewError("Photos must be JPG, PNG or WebP images.");
        if (file.size > MAX_REVIEW_IMAGE_BYTES) throw new ReviewError("Each photo must be 5 MB or smaller.");
        const detected = detectImageType(await readHead(file.path));
        if (!detected || detected !== file.mimetype) throw new ReviewError("One of the photos is not a valid image file.");
    }
};

export const displayNameFor = name => {
    const parts = typeof name === "string" ? name.replace(/\s+/g, " ").trim().split(" ").filter(Boolean) : [];
    if (!parts.length) return "PSH customer";
    const first = parts[0].slice(0, 30);
    return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
};

export const buildRatingSummary = counts => {
    const distribution = [1, 2, 3, 4, 5].map(star => Math.max(0, counts?.[star] || 0));
    const count = distribution.reduce((sum, value) => sum + value, 0);
    const total = distribution.reduce((sum, value, index) => sum + value * (index + 1), 0);
    return { count, average: count ? Math.round((total / count) * 10) / 10 : 0, distribution };
};

const sameSummary = (a, b) => a.count === b.count && a.average === b.average &&
    a.distribution.every((value, index) => value === b.distribution[index]);

// Derives the product's rating summary from approved reviews only. Writing then re-reading (once) closes the window
// where two concurrent moderations could each store a summary computed before the other's change was visible.
export const recomputeRatingSummary = async (productId, { reviewModel, productModel }) => {
    const read = async () => {
        const rows = await reviewModel.aggregate([
            { $match: { productId: String(productId), status: "approved" } },
            { $group: { _id: "$rating", n: { $sum: 1 } } }
        ]);
        return buildRatingSummary(Object.fromEntries(rows.map(row => [row._id, row.n])));
    };
    let summary = await read();
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await productModel.updateOne({ _id: productId }, { $set: { ratingSummary: summary } });
        const check = await read();
        if (sameSummary(summary, check)) return summary;
        summary = check;
    }
    return summary;
};

// A purchase only counts once it was delivered and the money was not returned or held for review.
export const isQualifyingOrder = (order, productId) => {
    if (!order || order.status !== "Delivered") return false;
    if (order.fulfillmentHold || order.paymentReviewRequired) return false;
    const paid = order.paymentStatus === "paid" ||
        (order.paymentStatus === "cod_pending" && String(order.paymentMethod || "").toLowerCase() === "cod");
    if (!paid) return false;
    if (Number.isSafeInteger(order.totalPaise) && order.totalPaise > 0 && (order.refundedPaise || 0) >= order.totalPaise) return false;
    return (order.items || []).some(item => String(item.productId) === String(productId));
};

export const findQualifyingOrder = async (orderModel, userId, productId) => {
    const orders = await orderModel.find({ userId, "items.productId": String(productId), status: "Delivered" })
        .sort({ createdAt: -1 }).limit(10).lean();
    return orders.find(order => isQualifyingOrder(order, productId)) || null;
};

export const validateModeration = ({ action, reason }) => {
    if (!Object.hasOwn(MODERATION_ACTIONS, action)) throw new ReviewError("Unknown moderation action.");
    const cleaned = cleanText(reason, { max: 500, label: "Reason" });
    if (REASON_REQUIRED.has(action) && !cleaned) throw new ReviewError("A reason is required for this action.");
    return { status: MODERATION_ACTIONS[action], reason: cleaned };
};

// Public shape: no user, order or moderation data.
export const toPublicReview = review => ({
    _id: String(review._id),
    rating: review.rating,
    title: review.title || "",
    body: review.body || "",
    displayName: review.displayName,
    date: review.source === "imported" && review.imported?.reviewDate ? review.imported.reviewDate : review.createdAt,
    verifiedPurchase: review.source === "customer" && review.verifiedPurchase === true,
    images: (review.images || []).map(image => ({ url: image.url }))
});

export const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
