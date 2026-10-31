import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import mongoose from "mongoose";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import storefrontSettingsModel from "../models/storefrontSettingsModel.js";
import notificationEventModel from "../models/notificationEventModel.js";
import { placeOrder } from "../controllers/orderController.js";
import { whatsappConsentFields } from "../utils/orderValidation.js";

const USER_ID = "665f1c2e8f1b2c0087654321";
const PRODUCT_ID = "665f1c2e8f1b2c00aaaaaaa1";
const VARIANT_ID = "665f1c2e8f1b2c00bbbbbbb1";
const KEY = "0b7a9a40-1c1e-4b0e-9f0e-5b7f9d5f3a11";

const address = {
    firstName: "Asha", lastName: "Verma", email: "asha@example.com", phone: "9876543210",
    street: "12 Gandhi Road", city: "Patna", state: "Bihar", zipcode: "800001", country: "India"
};

const query = value => ({
    session() { return this; },
    select() { return this; },
    lean() { return this; },
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
});

const jsonResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

let created;
let staged;
let stockWrites;
let outboxFails;

beforeEach(() => {
    created = [];
    staged = [];
    stockWrites = 0;
    outboxFails = false;
    mock.method(console, "error", () => {});
    mock.method(mongoose, "startSession", async () => ({
        async withTransaction(fn) {
            const before = { created: created.length, staged: staged.length, stockWrites };
            try { return await fn(); } catch (error) {
                created.length = before.created;
                staged.length = before.staged;
                stockWrites = before.stockWrites;
                throw error;
            }
        },
        async endSession() {}
    }));
    mock.method(orderModel, "findOne", () => query(created[0] || null));
    mock.method(orderModel, "create", async ([doc]) => {
        const saved = { ...doc, _id: "665f1c2e8f1b2c00cccccccc", status: "Order Placed", date: doc.date };
        created.push(saved);
        return [saved];
    });
    mock.method(userModel, "findById", () => query({ _id: USER_ID }));
    mock.method(userModel, "updateOne", async () => ({ modifiedCount: 1 }));
    mock.method(productModel, "find", () => query([{
        _id: PRODUCT_ID, name: "Silk Saree", pricePaise: 250000, images: [{ url: "https://img.example/a.jpg" }]
    }]));
    mock.method(productVariantModel, "find", () => query([{
        _id: VARIANT_ID, productId: PRODUCT_ID, sku: "SKU-1", priceOverridePaise: null
    }]));
    mock.method(productVariantModel, "updateOne", async () => { stockWrites += 1; return { modifiedCount: 1 }; });
    mock.method(storefrontSettingsModel, "findOne", () => query(null));
    mock.method(notificationEventModel, "updateOne", async (filter, update) => {
        if (outboxFails) throw new Error("mongo write failed");
        if (staged.some(item => item.dedupeKey === filter.dedupeKey)) return { upsertedCount: 0 };
        staged.push(update.$setOnInsert);
        return { upsertedCount: 1 };
    });
    mock.method(notificationEventModel, "find", () => ({ sort() { return this; }, limit() { return this; }, lean: async () => [] }));
});

afterEach(() => mock.restoreAll());

const request = (overrides = {}) => ({
    auth: { userId: USER_ID },
    body: { idempotencyKey: KEY, address, items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 }], ...overrides }
});

test("COD order creation writes the order and its order_placed outbox event in the same transaction", async () => {
    const res = jsonResponse();
    await placeOrder(request(), res);
    assert.equal(res.statusCode, 201);
    assert.equal(created.length, 1);
    assert.equal(created[0].paymentMethod, "COD");
    assert.equal(created[0].paymentStatus, "cod_pending");
    assert.deepEqual(staged.map(item => item.dedupeKey), ["665f1c2e8f1b2c00cccccccc:order_placed"]);
    assert.equal(staged[0].channels.email.status, "pending");
});

test("without checkout consent WhatsApp is skipped as no_opt_in while email still proceeds", async () => {
    await placeOrder(request(), jsonResponse());
    assert.equal(created[0].whatsappOptIn, false);
    assert.equal(staged[0].channels.whatsapp.status, "skipped");
    assert.equal(staged[0].channels.whatsapp.reason, "no_opt_in");
    assert.equal(staged[0].channels.email.status, "pending");
});

test("explicit consent records the opt-in and queues WhatsApp", async () => {
    await placeOrder(request({ whatsappOptIn: true }), jsonResponse());
    assert.equal(created[0].whatsappOptIn, true);
    assert.ok(created[0].whatsappOptInAt instanceof Date);
    assert.equal(staged[0].channels.whatsapp.status, "pending");
});

test("only a literal true counts as consent", () => {
    for (const value of ["true", 1, "yes", null, undefined, {}, []]) {
        assert.deepEqual(whatsappConsentFields({ whatsappOptIn: value }), { whatsappOptIn: false }, String(value));
    }
    assert.equal(whatsappConsentFields({ whatsappOptIn: true }).whatsappOptIn, true);
    assert.deepEqual(whatsappConsentFields(undefined), { whatsappOptIn: false });
});

test("if the outbox write fails the whole order transaction aborts: no order and no stock change survive", async () => {
    outboxFails = true;
    const res = jsonResponse();
    await placeOrder(request(), res);
    assert.equal(res.statusCode, 503);
    assert.equal(created.length, 0);
    assert.equal(stockWrites, 0);
});

test("order creation needs no notification credentials or provider configuration", async () => {
    for (const key of ["SMTP_HOST", "EMAIL_FROM", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) {
        assert.equal(process.env[key], undefined, `${key} must be unset for this test to be meaningful`);
    }
    const res = jsonResponse();
    await placeOrder(request(), res);
    assert.equal(res.statusCode, 201);
});

test("a repeated checkout request with the same key returns the existing order without staging again", async () => {
    await placeOrder(request(), jsonResponse());
    const again = jsonResponse();
    await placeOrder(request(), again);
    assert.equal(again.body.message, "This checkout request was already placed.");
    assert.equal(created.length, 1);
    assert.equal(staged.length, 1);
});
