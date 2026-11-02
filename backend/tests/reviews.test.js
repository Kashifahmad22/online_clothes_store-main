import test from "node:test";
import assert from "node:assert/strict";
import reviewModel from "../models/reviewModel.js";
import productModel from "../models/productModel.js";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import { v2 as cloudinary } from "cloudinary";
import {
    cleanText, parseReviewInput, parseRating, detectImageType, validateReviewImages, buildRatingSummary,
    recomputeRatingSummary, isQualifyingOrder, validateModeration, toPublicReview, displayNameFor
} from "../utils/reviews.js";
import {
    submitReview, listProductReviews, adminModerateReview, adminImportReview
} from "../controllers/reviewController.js";
import reviewRouter from "../routes/reviewRoute.js";
import { buildProductSeo } from "../utils/seo.js";

// Controller tests use in-memory stand-ins for the Mongoose models and Cloudinary. They verify logic and ordering,
// not real MongoDB, Cloudinary or concurrent-write behaviour.
const PID = "64b0f0f0f0f0f0f0f0f0f0f0";
const RID = "64b0f0f0f0f0f0f0f0f0f0f1";
const res = () => {
    const r = { statusCode: 200 };
    r.status = c => { r.statusCode = c; return r; };
    r.json = b => { r.body = b; return r; };
    return r;
};
const patch = patches => {
    const originals = patches.map(([t, k]) => [t, k, t[k]]);
    for (const [t, k, v] of patches) t[k] = v;
    return () => { for (const [t, k, v] of originals) t[k] = v; };
};
const chain = value => ({ select: () => chain(value), sort: () => chain(value), skip: () => chain(value), limit: () => chain(value), lean: async () => value, then: (a, b) => Promise.resolve(value).then(a, b) });

test("cleanText strips tags and control characters and enforces limits", () => {
    assert.equal(cleanText("<script>alert(1)</script>Lovely <b>saree</b>", { max: 100, label: "x" }).includes("<"), false);
    assert.equal(cleanText("a\u0000b", { max: 10, label: "x" }), "ab");
    assert.throws(() => cleanText("x".repeat(11), { max: 10, label: "Title" }), /10 characters/);
    assert.throws(() => cleanText({ $ne: 1 }, { max: 10, label: "Title" }), /must be text/);
});

test("rating and review input validation", () => {
    assert.equal(parseRating("5"), 5);
    for (const bad of [0, 6, 4.5, "abc", null, undefined, "5.5"]) assert.throws(() => parseRating(bad));
    assert.throws(() => parseReviewInput({ rating: 5, body: "   " }), /few words/);
    assert.deepEqual(parseReviewInput({ rating: "4", title: " Great ", body: "Nice" }), { rating: 4, title: "Great", body: "Nice" });
});

test("image signature detection and validation", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assert.equal(detectImageType(jpeg), "image/jpeg");
    assert.equal(detectImageType(png), "image/png");
    assert.equal(detectImageType(Buffer.from("<svg xmlns")), null);
    const good = { mimetype: "image/jpeg", size: 1000, path: "a" };
    await validateReviewImages([good], async () => jpeg);
    await assert.rejects(validateReviewImages([{ ...good, mimetype: "image/gif" }], async () => jpeg), /JPG, PNG or WebP/);
    await assert.rejects(validateReviewImages([{ ...good, size: 6 * 1024 * 1024 }], async () => jpeg), /5 MB/);
    await assert.rejects(validateReviewImages([good], async () => png), /not a valid image/);
    await assert.rejects(validateReviewImages(Array(5).fill(good), async () => jpeg), /up to 4/);
});

test("rating summary maths", () => {
    assert.deepEqual(buildRatingSummary({}), { count: 0, average: 0, distribution: [0, 0, 0, 0, 0] });
    assert.deepEqual(buildRatingSummary({ 5: 2, 4: 1 }), { count: 3, average: 4.7, distribution: [0, 0, 0, 1, 2] });
});

test("recomputeRatingSummary stores only approved counts and re-reads after writing", async () => {
    const writes = [];
    let reads = 0;
    const rows = [[{ _id: 5, n: 1 }], [{ _id: 5, n: 1 }, { _id: 3, n: 1 }], [{ _id: 5, n: 1 }, { _id: 3, n: 1 }]];
    const summary = await recomputeRatingSummary(PID, {
        reviewModel: { aggregate: async pipeline => { assert.equal(pipeline[0].$match.status, "approved"); return rows[Math.min(reads++, 2)]; } },
        productModel: { updateOne: async (_f, u) => { writes.push(u.$set.ratingSummary); } }
    });
    assert.equal(summary.count, 2);
    assert.equal(writes.length, 2);
    assert.equal(writes.at(-1).count, 2);
});

test("verified purchase eligibility follows the order lifecycle", () => {
    const base = { status: "Delivered", paymentStatus: "paid", paymentMethod: "Razorpay", totalPaise: 1000, refundedPaise: 0, items: [{ productId: PID }] };
    assert.equal(isQualifyingOrder(base, PID), true);
    assert.equal(isQualifyingOrder({ ...base, paymentStatus: "cod_pending", paymentMethod: "COD" }, PID), true);
    assert.equal(isQualifyingOrder({ ...base, paymentStatus: "cod_pending", paymentMethod: "Razorpay" }, PID), false);
    for (const patchIt of [{ status: "Cancelled" }, { status: "Order Placed" }, { paymentStatus: "refunded" }, { paymentStatus: "pending" },
        { paymentStatus: "failed" }, { fulfillmentHold: true }, { paymentReviewRequired: true }, { refundedPaise: 1000 }]) {
        assert.equal(isQualifyingOrder({ ...base, ...patchIt }, PID), false, JSON.stringify(patchIt));
    }
    assert.equal(isQualifyingOrder(base, "other"), false);
});

test("moderation requires reasons and known actions", () => {
    assert.deepEqual(validateModeration({ action: "approve" }), { status: "approved", reason: "" });
    assert.throws(() => validateModeration({ action: "reject" }), /reason is required/);
    assert.throws(() => validateModeration({ action: "hide", reason: "  " }), /reason is required/);
    assert.throws(() => validateModeration({ action: "delete", reason: "x" }), /Unknown/);
    assert.equal(validateModeration({ action: "flag", reason: "spam" }).status, "flagged");
});

test("public review shape hides private fields and never marks imports verified", () => {
    const pub = toPublicReview({ _id: RID, rating: 5, body: "x", displayName: "Asha K.", userId: "u1", orderId: "o1", moderation: [{}],
        source: "imported", verifiedPurchase: true, createdAt: new Date("2024-02-01"), imported: { reviewDate: new Date("2023-01-01") }, images: [{ url: "u", publicId: "p" }] });
    assert.equal(pub.verifiedPurchase, false);
    assert.equal(pub.userId, undefined);
    assert.equal(pub.orderId, undefined);
    assert.equal(pub.moderation, undefined);
    assert.deepEqual(pub.images, [{ url: "u" }]);
    assert.equal(pub.date.getUTCFullYear(), 2023);
    assert.equal(displayNameFor("Asha Kumari Singh"), "Asha S.");
    assert.equal(displayNameFor(""), "PSH customer");
});

const submitSetup = ({ existing = false, order = null, createError } = {}) => {
    const state = { created: null, uploads: [], destroyed: [] };
    const restore = patch([
        [productModel, "findById", () => chain({ _id: PID, status: "published" })],
        [reviewModel, "exists", async () => existing],
        [reviewModel, "create", async doc => { if (createError) throw createError; state.created = doc; return { _id: RID }; }],
        [userModel, "findById", () => chain({ name: "Asha Kumari" })],
        [orderModel, "find", () => chain(order ? [order] : [])],
        [cloudinary.uploader, "upload", async () => { state.uploads.push(1); return { secure_url: `https://cdn/${state.uploads.length}.jpg`, public_id: `p${state.uploads.length}` }; }],
        [cloudinary.uploader, "destroy", async id => { state.destroyed.push(id); }]
    ]);
    return { state, restore };
};
const call = async (setup, body, files = []) => {
    const r = res();
    try { await submitReview({ params: { productId: PID }, auth: { userId: "u1" }, body, files }, r); } finally { setup.restore(); }
    return r;
};

test("submitReview creates a pending review, derives name and ignores client verified flags", async () => {
    const s = submitSetup();
    const r = await call(s, { rating: "5", body: "Beautiful", verifiedPurchase: true, status: "approved", userId: "evil" });
    assert.equal(r.statusCode, 201);
    assert.equal(s.state.created.status, "pending");
    assert.equal(s.state.created.verifiedPurchase, false);
    assert.equal(s.state.created.userId, "u1");
    assert.equal(s.state.created.displayName, "Asha K.");
});

test("submitReview marks verified only with a qualifying order", async () => {
    const order = { _id: "64b0f0f0f0f0f0f0f0f0f0f2", status: "Delivered", paymentStatus: "paid", items: [{ productId: PID }], totalPaise: 100 };
    const s = submitSetup({ order });
    await call(s, { rating: 4, body: "Good" });
    assert.equal(s.state.created.verifiedPurchase, true);
    assert.equal(s.state.created.orderId, order._id);
});

test("submitReview rejects duplicates and invalid input before uploading", async () => {
    let s = submitSetup({ existing: true });
    assert.equal((await call(s, { rating: 5, body: "x" })).statusCode, 409);
    s = submitSetup();
    assert.equal((await call(s, { rating: 9, body: "x" })).statusCode, 400);
    assert.equal(s.state.uploads.length, 0);
});

test("submitReview maps a unique-index race to 409 and removes uploaded photos", async () => {
    const jpegPath = new URL(import.meta.url).pathname;
    const s = submitSetup({ createError: Object.assign(new Error("dup"), { code: 11000 }) });
    const r = res();
    const { writeFile, unlink } = await import("node:fs/promises");
    const path = `${process.env.TEMP || "/tmp"}/review-test-${Date.now()}.jpg`;
    await writeFile(path, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]));
    try {
        await submitReview({ params: { productId: PID }, auth: { userId: "u1" }, body: { rating: 5, body: "x" }, files: [{ path, mimetype: "image/jpeg", size: 100 }] }, r);
    } finally { s.restore(); await unlink(path).catch(() => {}); }
    assert.ok(jpegPath);
    assert.equal(r.statusCode, 409);
    assert.deepEqual(s.state.destroyed, ["p1"]);
});

test("public listing returns approved reviews only with stored summary", async () => {
    let filter;
    const restore = patch([
        [productModel, "findById", () => chain({ status: "published", ratingSummary: { count: 1, average: 5, distribution: [0, 0, 0, 0, 1] } })],
        [reviewModel, "find", f => { filter = f; return chain([{ _id: RID, rating: 5, body: "x", displayName: "A", userId: "u1", source: "customer", createdAt: new Date() }]); }],
        [reviewModel, "countDocuments", async () => 1]
    ]);
    const r = res();
    try { await listProductReviews({ params: { productId: PID }, query: {} }, r); } finally { restore(); }
    assert.equal(filter.status, "approved");
    assert.equal(r.body.summary.count, 1);
    assert.equal(r.body.reviews[0].userId, undefined);
    assert.equal(r.body.pagination.total, 1);
});

test("moderation records audit entry and recomputes the aggregate only when public state changes", async () => {
    const doc = { productId: PID, status: "pending", moderation: [], save: async () => {} };
    let aggregates = 0;
    const restore = patch([
        [reviewModel, "findById", async () => doc],
        [reviewModel, "aggregate", async () => { aggregates += 1; return []; }],
        [productModel, "updateOne", async () => {}]
    ]);
    try {
        let r = res();
        await adminModerateReview({ params: { id: RID }, body: { action: "reject", reason: "spam" } }, r);
        assert.equal(r.statusCode, 200);
        assert.equal(aggregates, 0);
        assert.deepEqual({ ...doc.moderation[0], at: undefined }, { action: "reject", from: "pending", to: "rejected", actor: "admin", reason: "spam", at: undefined });
        r = res();
        await adminModerateReview({ params: { id: RID }, body: { action: "approve" } }, r);
        assert.ok(aggregates >= 1);
        const before = aggregates;
        r = res();
        await adminModerateReview({ params: { id: RID }, body: { action: "hide", reason: "off-topic" } }, r);
        assert.ok(aggregates > before);
        r = res();
        await adminModerateReview({ params: { id: RID }, body: { action: "hide", reason: "again" } }, r);
        assert.equal(r.statusCode, 409);
        r = res();
        await adminModerateReview({ params: { id: RID }, body: { action: "reject" } }, r);
        assert.equal(r.statusCode, 400);
    } finally { restore(); }
});

test("admin import is never verified and needs permission, source and a valid date", async () => {
    let created;
    const restore = patch([
        [productModel, "exists", async () => true],
        [reviewModel, "create", async doc => { created = doc; return { _id: RID }; }],
        [reviewModel, "aggregate", async () => []],
        [productModel, "updateOne", async () => {}]
    ]);
    const valid = { productId: PID, rating: 5, body: "Loved it", displayName: "Meena", source: "WhatsApp", reviewDate: "2024-01-05", permissionConfirmed: true };
    try {
        for (const bad of [{ permissionConfirmed: false }, { source: "" }, { displayName: "" }, { reviewDate: "2999-01-01" }, { reviewDate: "nope" }, { productId: "x" }]) {
            const r = res();
            await adminImportReview({ body: { ...valid, ...bad } }, r);
            assert.equal(r.statusCode, 400, JSON.stringify(bad));
        }
        const r = res();
        await adminImportReview({ body: { ...valid, verifiedPurchase: true } }, r);
        assert.equal(r.statusCode, 201);
        assert.equal(created.verifiedPurchase, false);
        assert.equal(created.source, "imported");
        assert.equal(created.imported.permissionConfirmed, true);
    } finally { restore(); }
});

test("review routes: admin endpoints are admin-authenticated, submission needs customer auth", () => {
    const layers = reviewRouter.stack.filter(l => l.route).map(l => ({
        path: l.route.path, methods: Object.keys(l.route.methods), names: l.route.stack.map(s => s.handle.name)
    }));
    for (const route of layers.filter(l => l.path.startsWith("/admin"))) assert.equal(route.names[0], "adminAuth", route.path);
    for (const route of layers.filter(l => l.path.startsWith("/mine") || l.methods.includes("post") && l.path.startsWith("/product") || l.methods.includes("put"))) {
        assert.equal(route.names[0], "authUser", route.path);
    }
    assert.equal(layers.find(l => l.path === "/product/:productId" && l.methods.includes("get")).names.length, 1);
});

test("SEO emits aggregateRating only for products with published reviews", () => {
    const base = { name: "Silk Saree", slug: "silk", description: "A saree", images: [], status: "published", pricePaise: 100000 };
    const opts = { siteUrl: "https://example.test", brandName: "PSH" };
    const without = buildProductSeo({ ...base, ratingSummary: { count: 0, average: 0, distribution: [0, 0, 0, 0, 0] } }, [], opts);
    assert.equal(JSON.stringify(without).includes("aggregateRating"), false);
    assert.equal(JSON.stringify(buildProductSeo(base, [], opts)).includes("aggregateRating"), false);
    const withRating = JSON.stringify(buildProductSeo({ ...base, ratingSummary: { count: 3, average: 4.7, distribution: [0, 0, 0, 1, 2] } }, [], opts));
    assert.match(withRating, /"ratingValue":4.7/);
    assert.match(withRating, /"reviewCount":3/);
});
