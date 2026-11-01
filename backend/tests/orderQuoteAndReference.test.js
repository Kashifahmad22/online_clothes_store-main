import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import storefrontSettingsModel from "../models/storefrontSettingsModel.js";
import { quoteOrder } from "../controllers/orderController.js";
import { orderReference, serializeCustomerOrder } from "../utils/orderSerializers.js";

const id = () => new mongoose.Types.ObjectId();
const call = async body => {
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
    await quoteOrder({ body }, res);
    return res;
};

const stub = ({ products = [], variants = [], settings = null }) => {
    const originals = [productModel.find, productVariantModel.find, storefrontSettingsModel.findOne];
    productModel.find = async () => products;
    productVariantModel.find = async () => variants;
    storefrontSettingsModel.findOne = async () => settings;
    return () => {
        [productModel.find, productVariantModel.find, storefrontSettingsModel.findOne] = originals;
    };
};

test("order reference is derived from the last 12 hex characters of the id", () => {
    assert.equal(orderReference("64b7f3c2a1d4e5f601234abc"), "PSH-E5F601234ABC");
    assert.equal(orderReference("64b7f3c2a1d4e5f601234abc").length, "PSH-".length + 12);
    assert.notEqual(orderReference("64b7f3c2a1d4e5f601234abc"), "PSH-64B7F3C2A1D4E5F601234ABC");
    assert.equal(orderReference(""), "");
    assert.equal(orderReference(undefined), "");
    assert.equal(orderReference("abc123"), "");
    assert.equal(orderReference("not-hex-not-hex-not-hex"), "");
    const serialised = serializeCustomerOrder({ _id: "64b7f3c2a1d4e5f601234abc", items: [], totalPaise: 100 });
    assert.equal(serialised.orderReference, "PSH-E5F601234ABC");
    assert.equal(serialised._id, "64b7f3c2a1d4e5f601234abc");
});

test("backend and frontend order references are identical for the same ids", async () => {
    const { formatOrderReference } = await import("../../frontend/src/utils/orderDisplay.js");
    const ids = [
        "64b7f3c2a1d4e5f601234abc", "000000000000000000000000", "ffffffffffffffffffffffff",
        String(new mongoose.Types.ObjectId()), String(new mongoose.Types.ObjectId()), "x", "", "abc123"
    ];
    for (const id of ids) {
        assert.equal(formatOrderReference({ _id: id }), orderReference(id), id);
    }
    // An older 8-character server reference is ignored by the frontend in favour of the 12-character one.
    assert.equal(formatOrderReference({ _id: ids[0], orderReference: "PSH-01234ABC" }), "PSH-E5F601234ABC");
});

test("quote rejects malformed input before touching the database", async () => {
    const restore = stub({});
    try {
        assert.equal((await call({})).statusCode, 400);
        assert.equal((await call({ items: [] })).statusCode, 400);
        const productId = String(id());
        const variantId = String(id());
        assert.equal((await call({ items: [{ productId, variantId, quantity: 0 }] })).statusCode, 400);
        assert.equal((await call({ items: [{ productId, variantId, quantity: 1 }, { productId, variantId, quantity: 1 }] })).statusCode, 400);
    } finally { restore(); }
});

test("quote returns authoritative prices, ignores client prices and computes shipping from settings", async () => {
    const product = { _id: id(), name: "Silk Saree", pricePaise: 100000, images: [{ url: "https://img/1.jpg" }] };
    const variant = {
        _id: id(), productId: product._id, priceOverridePaise: 120000, stockOnHand: 5, reserved: 1,
        options: new Map([["colour", "Red"]])
    };
    const restore = stub({
        products: [product], variants: [variant],
        settings: { shipping: { feePaise: 6000, freeShippingThresholdPaise: 500000 } }
    });
    try {
        const res = await call({ items: [{ productId: String(product._id), variantId: String(variant._id), quantity: 2, price: 1 }] });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.lines[0].unitPricePaise, 120000);
        assert.equal(res.body.lines[0].lineTotalPaise, 240000);
        assert.deepEqual(res.body.lines[0].options, { colour: "Red" });
        assert.equal(res.body.lines[0].status, "ok");
        assert.equal(res.body.subtotalPaise, 240000);
        assert.equal(res.body.shippingPaise, 6000);
        assert.equal(res.body.totalPaise, 246000);
        assert.equal(res.body.hasIssues, false);
    } finally { restore(); }
});

test("quote flags unavailable and insufficient lines without throwing", async () => {
    const product = { _id: id(), name: "Cotton Saree", pricePaise: 50000, images: [] };
    const variant = { _id: id(), productId: product._id, stockOnHand: 2, reserved: 1, options: {} };
    const restore = stub({ products: [product], variants: [variant] });
    try {
        const res = await call({
            items: [
                { productId: String(product._id), variantId: String(variant._id), quantity: 3 },
                { productId: String(id()), variantId: String(id()), quantity: 1 }
            ]
        });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.lines[0].status, "insufficient");
        assert.equal(res.body.lines[0].availableQuantity, 1);
        assert.equal(res.body.lines[1].status, "unavailable");
        assert.equal(res.body.hasIssues, true);
    } finally { restore(); }
});
