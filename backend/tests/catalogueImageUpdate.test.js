import test from "node:test";
import assert from "node:assert/strict";
import { v2 as cloudinary } from "cloudinary";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import { updateProduct } from "../controllers/productController.js";
import { imagesUnchanged, normaliseDetailAttributes } from "../utils/catalogueValidation.js";

// These tests drive the real updateProduct controller against an in-memory stand-in for the Mongoose models and a
// stubbed Cloudinary client. They verify controller logic and ordering only, not real MongoDB or Cloudinary behaviour.
const ID = "64b0f0f0f0f0f0f0f0f0f0f0";
const img = (name, role = "other", altText = "", order) => ({ url: `https://img.test/${name}.jpg`, role, altText, order });
const file = name => ({ path: `no-such-dir/${name}.tmp`, originalname: `${name}.jpg` });
const slug = url => url.split("/").pop().replace(".jpg", "");

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.body = body; return res; };
    return res;
};

const setup = (stored, { missing = false } = {}) => {
    const state = { doc: missing ? null : { _id: ID, slug: "item", status: "draft", ...stored }, uploads: [] };
    const patches = [
        [productModel, "findById", async () => state.doc && { ...state.doc, toObject() { return { ...state.doc }; } }],
        [productModel, "startSession", async () => ({ withTransaction: fn => fn(), endSession: async () => {} })],
        [productModel, "updateOne", async (_filter, update) => { Object.assign(state.doc, update.$set); }],
        [productVariantModel, "find", async () => [{ _id: "v1", sku: "SKU-1", active: true, stockOnHand: 3 }]],
        [productVariantModel, "updateOne", async () => {}],
        [cloudinary.uploader, "upload", async path => {
            state.uploads.push(path);
            return { secure_url: `https://cdn.test/${state.uploads.length}.jpg` };
        }]
    ];
    const originals = patches.map(([target, key]) => [target, key, target[key]]);
    for (const [target, key, value] of patches) target[key] = value;
    return { state, restore: () => { for (const [target, key, value] of originals) target[key] = value; } };
};

const body = (overrides = {}, details = {}) => JSON.stringify({
    name: "Cotton Suit", description: "A suit piece", productType: "suit", category: "Suit Pieces",
    pricePaise: 100000, status: "draft", details, variants: [{ sku: "SKU-1", stockOnHand: 3 }], ...overrides
});

const run = async ({ stored, product, files = [], roles, alts, missing }) => {
    const env = setup(stored, { missing });
    try {
        const req = {
            params: { productId: ID },
            body: { product, ...(roles ? { imageRoles: JSON.stringify(roles) } : {}), ...(alts ? { imageAlts: JSON.stringify(alts) } : {}) },
            files
        };
        const res = response();
        await updateProduct(req, res);
        return { res, state: env.state };
    } finally {
        env.restore();
    }
};

const storedImages = [img("a", "primary", "Front", 0), img("b", "border", "Border", 1), img("c", "pallu", "Pallu", 2)];

test("a missing product returns 404 before any Cloudinary upload", async () => {
    const { res, state } = await run({
        missing: true, files: [file("n")], roles: ["other"], alts: ["New"],
        product: body({ images: storedImages.map(({ url, role, altText }) => ({ url, role, altText })) })
    });
    assert.equal(res.statusCode, 404);
    assert.equal(state.uploads.length, 0);
});

test("invalid image metadata is rejected before any Cloudinary upload", async () => {
    const saved = storedImages.map(({ url, role, altText }) => ({ url, role, altText }));
    const cases = [
        { roles: ["primary"], alts: ["New"], pattern: /only one primary/ },
        { roles: ["not-a-role"], alts: ["New"], pattern: /./ },
        { roles: ["other"], alts: ["x".repeat(161)], pattern: /160 characters/ },
        { roles: ["other"], alts: [], pattern: /one alt text/ }
    ];
    for (const { roles, alts, pattern } of cases) {
        const { res, state } = await run({
            stored: { images: storedImages, details: {} }, files: [file("n")], roles, alts, product: body({ images: saved })
        });
        assert.equal(res.statusCode, 400, JSON.stringify(roles));
        assert.match(res.body.message, pattern);
        assert.equal(state.uploads.length, 0);
    }
});

test("saved order, a removed image, a new primary and appended uploads are persisted exactly", async () => {
    const reordered = [img("c", "primary", "Pallu"), img("a", "other", "Front")];
    const { res, state } = await run({
        stored: { images: storedImages, details: {} },
        files: [file("n1"), file("n2")], roles: ["detail", "lifestyle"], alts: ["  Close   up ", ""],
        product: body({ images: reordered })
    });
    assert.equal(res.statusCode, 200, res.body?.message);
    assert.deepEqual(state.doc.images.map(item => [slug(item.url), item.role, item.altText, item.order]), [
        ["c", "primary", "Pallu", 0],
        ["a", "other", "Front", 1],
        ["1", "detail", "Close up", 2],
        ["2", "lifestyle", "", 3]
    ]);
    assert.equal(state.doc.images.filter(item => item.role === "primary").length, 1);
    assert.equal(state.uploads.length, 2);

    // Reloading and saving the persisted list unchanged keeps the same order.
    const second = await run({
        stored: { images: state.doc.images, details: {} },
        product: body({ images: state.doc.images.map(({ url, role, altText }) => ({ url, role, altText })) })
    });
    assert.equal(second.res.statusCode, 200);
    assert.deepEqual(second.state.doc.images.map(item => slug(item.url)), ["c", "a", "1", "2"]);
});

test("changing the primary moves it first and leaves exactly one primary", async () => {
    const submitted = [img("a", "other", "Front"), img("b", "primary", "Border"), img("c", "pallu", "Pallu")];
    const { res, state } = await run({ stored: { images: storedImages, details: {} }, product: body({ images: submitted }) });
    assert.equal(res.statusCode, 200, res.body?.message);
    assert.deepEqual(state.doc.images.map(item => [slug(item.url), item.role]), [["b", "primary"], ["a", "other"], ["c", "pallu"]]);
});

test("a changed image collection without exactly one primary is rejected, and nothing is uploaded", async () => {
    for (const submitted of [
        [img("a", "other"), img("b", "other")],
        [img("a", "primary"), img("b", "primary")]
    ]) {
        const { res, state } = await run({ stored: { images: storedImages, details: {} }, product: body({ images: submitted }) });
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /primary image/);
        assert.equal(state.uploads.length, 0);
    }
});

test("an ordinary edit keeps legacy image metadata (two primaries, long alt text) untouched", async () => {
    const legacy = [img("a", "primary", "x".repeat(200), 0), img("b", "primary", "", 1)];
    const { res, state } = await run({
        stored: { images: legacy, details: {} },
        product: body({ name: "Renamed Suit", images: legacy.map(({ url, role, altText }) => ({ url, role, altText })) })
    });
    assert.equal(res.statusCode, 200, res.body?.message);
    assert.equal(state.doc.name, "Renamed Suit");
    assert.deepEqual(state.doc.images, legacy);

    const omitted = await run({ stored: { images: legacy, details: {} }, product: body({ name: "Renamed Again" }) });
    assert.equal(omitted.res.statusCode, 200, omitted.res.body?.message);
    assert.deepEqual(omitted.state.doc.images, legacy);
});

test("touching legacy images (reorder or upload) requires a valid collection", async () => {
    const legacy = [img("a", "primary", "", 0), img("b", "primary", "", 1)];
    const swapped = await run({ stored: { images: legacy, details: {} }, product: body({ images: [legacy[1], legacy[0]] }) });
    assert.equal(swapped.res.statusCode, 400);
    const repaired = await run({
        stored: { images: legacy, details: {} },
        product: body({ images: [img("a", "primary"), img("b", "other")] })
    });
    assert.equal(repaired.res.statusCode, 200, repaired.res.body?.message);
    assert.deepEqual(repaired.state.doc.images.map(item => item.role), ["primary", "other"]);
});

test("an untouched legacy placeholder does not block an unrelated edit and is not rewritten", async () => {
    const stored = { images: storedImages, details: { fabric: "N/A", colour: "none", careInstructions: "Dry clean", extra: 1 } };
    const { res, state } = await run({
        stored, product: body({ name: "Renamed" }, { fabric: "  N/A ", colour: "none", careInstructions: "Dry clean", extra: 1 })
    });
    assert.equal(res.statusCode, 200, res.body?.message);
    assert.equal(state.doc.name, "Renamed");
    assert.deepEqual(state.doc.details, { fabric: "N/A", colour: "none", careInstructions: "Dry clean", extra: 1 });
});

test("a changed or newly entered fabric/colour is still validated and trimmed", async () => {
    const stored = { images: storedImages, details: { fabric: "N/A", colour: "Red" } };
    for (const details of [{ fabric: "n/a", colour: "Red" }, { fabric: "Silk", colour: "NONE" }, { fabric: "N/A", colour: "x".repeat(81) }]) {
        const { res } = await run({ stored, product: body({}, details) });
        assert.equal(res.statusCode, 400, JSON.stringify(details));
    }
    const fixed = await run({ stored, product: body({}, { fabric: "  Pure   Silk ", colour: "Red" }) });
    assert.equal(fixed.res.statusCode, 200, fixed.res.body?.message);
    assert.deepEqual(fixed.state.doc.details, { fabric: "Pure Silk", colour: "Red" });

    const cleared = await run({ stored, product: body({}, { fabric: "", colour: "Red" }) });
    assert.equal(cleared.res.statusCode, 200);
    assert.equal(cleared.state.doc.details.fabric, "");
});

test("helpers: unchanged detection and legacy attribute comparison", () => {
    const saved = [img("a", "primary", "Front")];
    assert.equal(imagesUnchanged([{ url: saved[0].url, role: "primary", altText: "Front" }], saved), true);
    assert.equal(imagesUnchanged([{ url: saved[0].url, role: "primary", altText: "Front" }], saved, 1), false);
    assert.equal(imagesUnchanged([{ url: saved[0].url, role: "other", altText: "Front" }], saved), false);
    assert.equal(imagesUnchanged([], saved), false);
    assert.throws(() => normaliseDetailAttributes({ fabric: "N/A" }, {}), /placeholder/);
    assert.throws(() => normaliseDetailAttributes({ fabric: "N/A" }), /placeholder/);
    assert.deepEqual(normaliseDetailAttributes({ fabric: "N/A" }, { fabric: "N/A" }), { fabric: "N/A" });
});
