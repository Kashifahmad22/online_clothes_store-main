import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { afterEach, beforeEach, mock } from "node:test";
import mongoose from "mongoose";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import productVariantModel from "../models/productVariantModel.js";
import razorpayWebhookEventModel from "../models/razorpayWebhookEventModel.js";
import notificationEventModel from "../models/notificationEventModel.js";
import {
    createRazorpayOrder,
    razorpayGateway,
    razorpayWebhook,
    releaseExpiredRazorpayReservations,
    retryRazorpayOrder,
    verifyRazorpayPayment
} from "../controllers/razorpayController.js";
import { resolvePaymentReview, updateStatus } from "../controllers/orderController.js";
import { isEligibleForPrepaidFulfillment } from "../utils/orderFulfillment.js";
import {
    PAYMENT_TRANSITIONS,
    applyPaymentAttempt,
    canTransitionPayment,
    getPaymentBlock,
    transitionPayment
} from "../utils/paymentStateMachine.js";

// Mocked only: stubbed models and a fake gateway. These tests exercise the real controller and policy code
// against an in-memory stock simulation; they do not prove real MongoDB transaction or Razorpay behaviour.
const KEY_SECRET = "test_key_secret_value";
const WEBHOOK_SECRET = "test_webhook_secret_value";
const ENV_KEYS = ["RAZORPAY_MODE", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
const ORDER_ID = "665f1c2e8f1b2c0012345678";
const USER_ID = "665f1c2e8f1b2c0087654321";
const RZP_ORDER = "order_TEST0001";
const PAY_A = "pay_AAAA0001";
const PAY_B = "pay_BBBB0002";
const IDEM_KEY = "123e4567-e89b-42d3-a456-426614174000";
const FUTURE = () => new Date(Date.now() + 10 * 60 * 1000);
const PAST = () => new Date(Date.now() - 60 * 1000);

let savedEnv;
let order;
let variants;
let staged;
let webhookEventIds;
let cartClears;
let gatewayPayment;

const query = value => ({
    session() { return this; },
    select() { return this; },
    limit() { return this; },
    lean() { return this; },
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
});

const makeOrder = (overrides = {}) => {
    const data = {
        _id: ORDER_ID,
        userId: USER_ID,
        paymentMethod: "Razorpay",
        paymentStatus: "pending",
        status: "Order Placed",
        payment: false,
        totalPaise: 250000,
        razorpayOrderId: RZP_ORDER,
        razorpaySetupStatus: "ready",
        razorpayPaymentId: "",
        idempotencyKey: IDEM_KEY,
        reservationHeld: true,
        reservationExpiresAt: FUTURE(),
        fulfillmentHold: false,
        paymentReviewRequired: false,
        paymentReviewReason: "",
        refundedPaise: 0,
        refunds: [],
        duplicatePaymentIds: Object.assign([], { addToSet(id) { if (!this.includes(id)) this.push(id); } }),
        statusHistory: [],
        whatsappOptIn: false,
        address: { firstName: "Asha", lastName: "K", email: "asha@example.com", phone: "9876543210" },
        items: [{ variantId: "v1", productId: "p1", quantity: 2, name: "Saree", sku: "S1" }],
        ...overrides
    };
    data.save = async () => data;
    return data;
};

const matchesFilter = (doc, filter) => Object.entries(filter).every(([key, value]) =>
    key === "$or" ? value.some(part => matchesFilter(doc, part)) : String(doc[key]) === String(value));

const clone = value => Array.isArray(value) ? structuredClone([...value]) : structuredClone(value);
const snapshot = doc => Object.fromEntries(Object.entries(doc)
    .filter(([, value]) => typeof value !== "function")
    .map(([key, value]) => [key, clone(value)]));
const restore = (doc, saved) => {
    for (const [key, value] of Object.entries(saved)) {
        if (Array.isArray(doc[key])) doc[key].splice(0, doc[key].length, ...value);
        else doc[key] = value;
    }
};

// Mirrors the conditional guards the controllers put in their updateOne filters.
const applyVariantUpdate = (filter, update) => {
    const variant = variants[filter._id];
    if (!variant) return 0;
    if (filter.active === true && !variant.active) return 0;
    if (filter.reserved?.$gte !== undefined && !(variant.reserved >= filter.reserved.$gte)) return 0;
    if (filter.stockOnHand?.$gte !== undefined && !(variant.stockOnHand >= filter.stockOnHand.$gte)) return 0;
    if (filter.$expr && !(variant.stockOnHand - variant.reserved >= filter.$expr.$gte[1])) return 0;
    for (const [field, delta] of Object.entries(update.$inc)) variant[field] += delta;
    return 1;
};

const assertStockInvariants = () => {
    for (const [id, variant] of Object.entries(variants)) {
        assert.ok(variant.stockOnHand >= 0, `${id} stockOnHand must never be negative`);
        assert.ok(variant.reserved >= 0, `${id} reserved must never be negative`);
        assert.ok(variant.reserved <= variant.stockOnHand, `${id} cannot reserve more than it holds`);
    }
};

const jsonResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const payment = (overrides = {}) => ({
    id: PAY_A, order_id: RZP_ORDER, amount: 250000, currency: "INR", status: "captured", ...overrides
});

const signedWebhook = (payload, eventId) => {
    const body = Buffer.from(JSON.stringify(payload));
    const headers = {
        "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex"),
        "x-razorpay-event-id": eventId
    };
    return { body, get: name => headers[name.toLowerCase()] };
};

const sendWebhook = async (event, entity, eventId) => {
    const res = jsonResponse();
    await razorpayWebhook(signedWebhook({ event, payload: { payment: { entity } } }, eventId), res);
    return res;
};
const capture = (eventId, entity = payment()) => sendWebhook("payment.captured", entity, eventId);
const fail = (eventId, entity = payment({ status: "failed" })) => sendWebhook("payment.failed", entity, eventId);

const verify = async entity => {
    gatewayPayment = entity;
    const res = jsonResponse();
    await verifyRazorpayPayment({
        body: {
            orderId: ORDER_ID,
            razorpay_order_id: RZP_ORDER,
            razorpay_payment_id: entity.id,
            razorpay_signature: createHmac("sha256", KEY_SECRET).update(`${RZP_ORDER}|${entity.id}`).digest("hex")
        },
        auth: { userId: USER_ID }
    }, res);
    return res;
};

const retry = async () => {
    const res = jsonResponse();
    await retryRazorpayOrder({ body: { orderId: ORDER_ID }, auth: { userId: USER_ID } }, res);
    return res;
};

const replayCreate = async () => {
    const res = jsonResponse();
    await createRazorpayOrder({
        body: {
            idempotencyKey: IDEM_KEY,
            items: [],
            address: {
                firstName: "Asha", lastName: "K", email: "asha@example.com", street: "1 Road",
                city: "Patna", state: "Bihar", zipcode: "800001", country: "India", phone: "9876543210"
            }
        },
        auth: { userId: USER_ID }
    }, res);
    return res;
};

const cancel = async () => {
    const res = jsonResponse();
    await updateStatus({ body: { orderId: ORDER_ID, status: "Cancelled" } }, res);
    return res;
};

const review = async (action, reason = "Checked with the customer") => {
    const res = jsonResponse();
    await resolvePaymentReview({ body: { orderId: ORDER_ID, action, reason } }, res);
    return res;
};

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    Object.assign(process.env, {
        RAZORPAY_MODE: "test",
        RAZORPAY_KEY_ID: "rzp_test_fakekeyid",
        RAZORPAY_KEY_SECRET: KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET
    });
    order = makeOrder();
    // One order of 2 units is reserved: 5 on hand, 2 reserved.
    variants = {
        v1: { stockOnHand: 5, reserved: 2, active: true },
        v2: { stockOnHand: 5, reserved: 0, active: true }
    };
    staged = [];
    webhookEventIds = new Set();
    cartClears = 0;
    gatewayPayment = null;
    mock.method(razorpayGateway, "client", () => ({ payments: { fetch: async () => gatewayPayment } }));

    mock.method(mongoose, "startSession", async () => ({
        async withTransaction(fn) {
            const savedOrder = snapshot(order);
            const savedVariants = structuredClone(variants);
            try { return await fn(); } catch (error) {
                restore(order, savedOrder);
                variants = savedVariants;
                throw error;
            }
        },
        async endSession() {}
    }));
    mock.method(orderModel, "findOne", filter => query(matchesFilter(order, filter) ? order : null));
    mock.method(orderModel, "findById", id => query(String(id) === ORDER_ID ? order : null));
    mock.method(orderModel, "find", () => query(
        order.reservationHeld && order.reservationExpiresAt <= new Date() &&
        ["pending", "authorized", "failed"].includes(order.paymentStatus) ? [order] : []
    ));
    mock.method(razorpayWebhookEventModel, "create", async ([doc]) => {
        if (webhookEventIds.has(doc.eventId)) throw Object.assign(new Error("E11000"), { code: 11000 });
        webhookEventIds.add(doc.eventId);
    });
    mock.method(userModel, "updateOne", async () => { cartClears += 1; return { modifiedCount: 1 }; });
    mock.method(productVariantModel, "exists", filter => {
        const variant = variants[filter._id];
        return query(Boolean(variant) && variant.reserved >= filter.reserved.$gte &&
            variant.stockOnHand >= filter.stockOnHand.$gte);
    });
    mock.method(productVariantModel, "updateOne", async (filter, update) => ({
        modifiedCount: applyVariantUpdate(filter, update)
    }));
    mock.method(notificationEventModel, "updateOne", async (filter, update) => {
        if (staged.some(item => item.dedupeKey === filter.dedupeKey)) return { upsertedCount: 0 };
        staged.push(update.$setOnInsert);
        return { upsertedCount: 1 };
    });
    mock.method(notificationEventModel, "find", () => ({ sort() { return this; }, limit() { return this; }, lean: async () => [] }));
    mock.method(console, "error", () => {});
});

afterEach(() => {
    assertStockInvariants();
    mock.restoreAll();
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
});

// 1
test("payment.failed while the reservation is active keeps the reservation and its original deadline", async () => {
    const deadline = order.reservationExpiresAt;
    const res = await fail("evt_f1");
    assert.equal(res.body.result, "processed");
    assert.equal(order.paymentStatus, "failed");
    assert.equal(order.reservationHeld, true);
    assert.equal(order.reservationExpiresAt, deadline, "a failed attempt must not extend the reservation");
    assert.deepEqual(variants.v1, { stockOnHand: 5, reserved: 2, active: true });
});

// 2
test("payment.failed followed by a successful capture settles the order against the original reservation", async () => {
    await fail("evt_f1");
    await capture("evt_c1", payment({ id: PAY_B }));
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.fulfillmentHold, false);
    assert.equal(order.razorpayPaymentId, PAY_B);
    assert.equal(order.reservationHeld, false);
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
    assert.equal(isEligibleForPrepaidFulfillment(order), true);
});

// 3
test("a late payment.failed after a successful capture never downgrades the paid order or touches stock", async () => {
    await capture("evt_c1");
    const before = structuredClone(variants);
    const history = order.statusHistory.length;
    await fail("evt_late_fail", payment({ id: PAY_B, status: "failed" }));
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.statusHistory.length, history);
    assert.deepEqual(variants, before);
    const viaVerify = await verify(payment({ id: PAY_B, status: "failed" }));
    assert.equal(viaVerify.statusCode, 402);
    assert.equal(viaVerify.body.paymentStatus, "paid", "verification reports the real state, not a failure");
    assert.equal(order.paymentStatus, "paid");
});

// 4
test("duplicate payment.failed deliveries are idempotent", async () => {
    await fail("evt_f1");
    const history = order.statusHistory.length;
    assert.equal((await fail("evt_f1")).body.result, "duplicate");
    assert.equal((await fail("evt_f2")).body.result, "processed");
    assert.equal(order.statusHistory.length, history, "a repeated failure adds no history");
    assert.equal(order.paymentStatus, "failed");
    assert.equal(variants.v1.reserved, 2);
});

test("a failure for an older attempt cannot undo a newer authorized attempt", async () => {
    await sendWebhook("payment.authorized", payment({ id: PAY_B, status: "authorized" }), "evt_auth");
    assert.equal(order.paymentStatus, "authorized");
    await fail("evt_old_fail", payment({ id: PAY_A, status: "failed" }));
    assert.equal(order.paymentStatus, "authorized");
    await capture("evt_cap", payment({ id: PAY_B }));
    assert.equal(order.paymentStatus, "paid");
});

// 5
test("capture with an active reservation deducts stock once and releases the reservation", async () => {
    await capture("evt_c1");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.fulfillmentHold, false);
    assert.equal(order.paymentReviewRequired, false);
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
    assert.ok(cartClears > 0, "the purchased lines are removed from the saved cart");
});

// 6
test("a capture after the reservation expired re-acquires stock atomically and records why", async () => {
    order.reservationExpiresAt = PAST();
    await releaseExpiredRazorpayReservations();
    assert.equal(order.paymentStatus, "expired");
    assert.deepEqual(variants.v1, { stockOnHand: 5, reserved: 0, active: true });

    await capture("evt_late");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.fulfillmentHold, false);
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
    const notes = order.statusHistory.map(entry => entry.note || "");
    assert.ok(notes.some(note => /re-acquired/.test(note)), "the late capture is recorded in history");
});

// 7
test("a capture when stock is no longer available holds the order for review and takes no stock", async () => {
    order.items = [
        { variantId: "v2", productId: "p2", quantity: 1, name: "Kurti", sku: "K1" },
        { variantId: "v1", productId: "p1", quantity: 2, name: "Saree", sku: "S1" }
    ];
    variants.v1 = { stockOnHand: 1, reserved: 0, active: true };
    order.reservationHeld = false;
    order.paymentStatus = "expired";

    await capture("evt_late");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.fulfillmentHold, true);
    assert.equal(order.paymentReviewRequired, true);
    assert.equal(order.paymentReviewReason, "stock_unavailable");
    assert.deepEqual(variants.v1, { stockOnHand: 1, reserved: 0, active: true });
    assert.equal(variants.v2.stockOnHand, 5, "the partially acquired item was put back");
    assert.equal(isEligibleForPrepaidFulfillment(order), false);
    assert.equal(order.refundedPaise, 0);
    assert.equal(order.statusHistory.some(entry => entry.to === "refunded"), false);
});

// 8
test("a duplicate capture of the same payment, by webhook or verification, deducts nothing more", async () => {
    await capture("evt_c1");
    const after = structuredClone(variants);
    const history = order.statusHistory.length;
    assert.equal((await capture("evt_c1")).body.result, "duplicate");
    assert.equal((await capture("evt_c2")).body.result, "processed");
    assert.equal((await verify(payment())).statusCode, 200);
    assert.deepEqual(variants, after);
    assert.equal(order.statusHistory.length, history);
    assert.equal(order.duplicatePaymentIds.length, 0);
    assert.equal(order.fulfillmentHold, false);
});

// 9
test("a second distinct captured payment is recorded for review and deducts no stock", async () => {
    await capture("evt_c1");
    const after = structuredClone(variants);
    await capture("evt_c2", payment({ id: PAY_B }));
    assert.deepEqual([...order.duplicatePaymentIds], [PAY_B]);
    assert.equal(order.razorpayPaymentId, PAY_A, "the first payment stays the order's payment");
    assert.equal(order.paymentReviewRequired, true);
    assert.equal(order.paymentReviewReason, "duplicate_payment");
    assert.equal(order.fulfillmentHold, true);
    assert.deepEqual(variants, after);
    await capture("evt_c3", payment({ id: PAY_B }));
    assert.equal(order.duplicatePaymentIds.length, 1, "the same duplicate is not recorded twice");
});

// 10
test("retry after cancellation is rejected with a stable code and reserves no stock", async () => {
    await cancel();
    assert.equal(order.status, "Cancelled");
    const before = structuredClone(variants);
    order.paymentStatus = "failed";
    const res = await retry();
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "ORDER_CANCELLED");
    assert.deepEqual(variants, before);
});

// 11
test("retry after a successful payment is rejected and a verified payment cannot be retried", async () => {
    await capture("evt_c1");
    const before = structuredClone(variants);
    const res = await retry();
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "ORDER_ALREADY_PAID");
    assert.deepEqual(variants, before);
});

test("retry is rejected for review holds, expired windows and half-finished setup", async () => {
    order = makeOrder({ paymentStatus: "failed", fulfillmentHold: true, paymentReviewRequired: true });
    assert.equal((await retry()).body.code, "PAYMENT_REVIEW_REQUIRED");
    order = makeOrder({ paymentStatus: "expired", reservationHeld: false });
    assert.equal((await retry()).body.code, "PAYMENT_WINDOW_EXPIRED");
    order = makeOrder({ paymentStatus: "failed", reservationExpiresAt: PAST() });
    assert.equal((await retry()).body.code, "PAYMENT_WINDOW_EXPIRED");
    order = makeOrder({ paymentStatus: "failed", reservationHeld: false, razorpaySetupStatus: "failed", razorpayOrderId: undefined });
    const res = await retry();
    assert.equal(res.body.code, "PAYMENT_SETUP_INCOMPLETE");
    assert.deepEqual(variants.v1, { stockOnHand: 5, reserved: 2, active: true });
});

test("a legitimate retry of a failed order keeps the reservation and the original deadline", async () => {
    const deadline = order.reservationExpiresAt;
    await fail("evt_f1");
    const res = await retry();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.razorpayOrderId, RZP_ORDER);
    assert.equal(order.paymentStatus, "pending");
    assert.equal(order.reservationExpiresAt, deadline);
    assert.equal(variants.v1.reserved, 2, "no second reservation is taken");
});

test("retrying a failed order whose stock was released re-reserves atomically or fails without a partial hold", async () => {
    order = makeOrder({
        paymentStatus: "failed",
        reservationHeld: false,
        items: [
            { variantId: "v2", productId: "p2", quantity: 1, name: "Kurti", sku: "K1" },
            { variantId: "v1", productId: "p1", quantity: 2, name: "Saree", sku: "S1" }
        ]
    });
    variants.v1 = { stockOnHand: 2, reserved: 1, active: true };
    const blocked = await retry();
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.body.code, "INSUFFICIENT_STOCK");
    assert.equal(variants.v2.reserved, 0, "the first item's reservation rolled back with the transaction");
    assert.equal(order.reservationHeld, false);

    variants.v1 = { stockOnHand: 5, reserved: 0, active: true };
    const ok = await retry();
    assert.equal(ok.statusCode, 200);
    assert.equal(order.reservationHeld, true);
    assert.equal(variants.v2.reserved, 1);
    assert.equal(variants.v1.reserved, 2);
});

// 12
test("idempotent replay of a cancelled order is refused instead of returning a payable order", async () => {
    await cancel();
    const res = await replayCreate();
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "ORDER_CANCELLED");
    assert.equal(res.body.razorpayOrderId, undefined);
});

// 13
test("idempotent replay of an expired order is refused, while an active one is replayed unchanged", async () => {
    order.reservationExpiresAt = PAST();
    await releaseExpiredRazorpayReservations();
    const expired = await replayCreate();
    assert.equal(expired.statusCode, 409);
    assert.equal(expired.body.code, "PAYMENT_WINDOW_EXPIRED");

    order = makeOrder();
    const active = await replayCreate();
    assert.equal(active.statusCode, 200);
    assert.equal(active.body.razorpayOrderId, RZP_ORDER);

    order = makeOrder({ paymentStatus: "paid", payment: true, reservationHeld: false });
    assert.equal((await replayCreate()).body.code, "ORDER_ALREADY_PAID");
    order = makeOrder({ fulfillmentHold: true, paymentStatus: "paid", reservationHeld: false });
    assert.equal((await replayCreate()).statusCode, 409);
});

// 14
test("cancelling a pending prepaid order closes it for payment and releases stock", async () => {
    const res = await cancel();
    assert.equal(res.statusCode, 200);
    assert.equal(order.status, "Cancelled");
    assert.equal(order.paymentStatus, "expired");
    assert.equal(order.reservationHeld, false);
    assert.deepEqual(variants.v1, { stockOnHand: 5, reserved: 0, active: true });
    assert.equal((await replayCreate()).body.code, "ORDER_CANCELLED");
    assert.equal((await verify(payment({ status: "failed" }))).statusCode, 402);
    assert.equal(order.paymentStatus, "expired", "a failure event cannot reopen a cancelled order");
});

test("cancellation racing with capture: cancel first keeps the payment as reviewable evidence, never a refund", async () => {
    await cancel();
    const res = await capture("evt_after_cancel");
    assert.equal(res.body.result, "processed");
    assert.equal(order.status, "Cancelled");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.fulfillmentHold, true);
    assert.equal(order.paymentReviewRequired, true);
    assert.equal(order.paymentReviewReason, "order_cancelled");
    assert.equal(order.razorpayPaymentId, PAY_A, "the late payment is preserved");
    assert.equal(order.refundedPaise, 0);
    assert.equal(order.statusHistory.some(entry => entry.to === "refunded"), false);
    assert.deepEqual(variants.v1, { stockOnHand: 5, reserved: 0, active: true }, "no stock is taken for a cancelled order");
    assert.equal(cartClears, 0);
    assert.equal((await retry()).body.code, "ORDER_CANCELLED");
});

test("cancellation racing with capture: capture first blocks the cancellation and keeps the sale intact", async () => {
    await capture("evt_c1");
    const res = await cancel();
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "PAID_ORDER_REQUIRES_REFUND");
    assert.equal(order.status, "Order Placed");
    assert.equal(order.paymentStatus, "paid");
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
});

test("cancelling while a payment is authorized flags it for review instead of hiding it", async () => {
    await sendWebhook("payment.authorized", payment({ status: "authorized" }), "evt_auth");
    assert.equal(order.paymentStatus, "authorized");
    await cancel();
    assert.equal(order.status, "Cancelled");
    assert.equal(order.paymentStatus, "authorized", "the gateway state is not rewritten or faked");
    assert.equal(order.paymentReviewRequired, true);
    assert.equal(order.paymentReviewReason, "authorized_on_closed_order");
    assert.equal(variants.v1.reserved, 0);
});

test("a paid order held for review can be cancelled without stock changes and stays flagged", async () => {
    order.reservationHeld = false;
    order.paymentStatus = "expired";
    variants.v1 = { stockOnHand: 1, reserved: 0, active: true };
    await capture("evt_c1");
    assert.equal(order.paymentReviewReason, "stock_unavailable");
    const res = await cancel();
    assert.equal(res.statusCode, 200);
    assert.equal(order.status, "Cancelled");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.paymentReviewReason, "order_cancelled");
    assert.equal(order.fulfillmentHold, true);
    assert.equal(variants.v1.stockOnHand, 1);
    assert.equal(order.statusHistory.at(-1).kind, "fulfilment");
    assert.ok(order.statusHistory.some(entry => /not been refunded/.test(entry.note || "")));
});

// 15
test("expiry racing with capture: capture first leaves nothing for the sweeper to release", async () => {
    order.reservationExpiresAt = PAST();
    await capture("evt_c1");
    assert.equal(order.paymentStatus, "paid");
    await releaseExpiredRazorpayReservations();
    assert.equal(order.paymentStatus, "paid");
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
});

test("expiry racing with capture: a reservation past its deadline but not yet swept is still settled correctly", async () => {
    order.reservationExpiresAt = PAST();
    await verify(payment());
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.fulfillmentHold, false);
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
});

test("the sweeper expires an unpaid reservation once and a repeated run is a no-op", async () => {
    await fail("evt_f1");
    order.reservationExpiresAt = PAST();
    await releaseExpiredRazorpayReservations();
    assert.equal(order.paymentStatus, "expired");
    assert.equal(order.reservationHeld, false);
    assert.deepEqual(variants.v1, { stockOnHand: 5, reserved: 0, active: true });
    const history = order.statusHistory.length;
    await releaseExpiredRazorpayReservations();
    assert.equal(order.statusHistory.length, history);
    assert.equal(variants.v1.reserved, 0);
});

// 16
test("stock is deducted exactly once across every capture path, in any order", async () => {
    await sendWebhook("payment.authorized", payment({ status: "authorized" }), "evt_auth");
    await verify(payment());
    await capture("evt_c1");
    const res = jsonResponse();
    await razorpayWebhook(signedWebhook({
        event: "order.paid",
        payload: { order: { entity: { id: RZP_ORDER, amount_paid: 250000, currency: "INR", status: "paid" } } }
    }, "evt_order_paid"), res);
    await verify(payment());
    assert.equal(order.paymentStatus, "paid");
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
});

test("a capture after expiry followed by every duplicate path still deducts stock only once", async () => {
    order.reservationExpiresAt = PAST();
    await releaseExpiredRazorpayReservations();
    await capture("evt_late");
    await capture("evt_late_again");
    await verify(payment());
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
});

test("authorized after the order stopped accepting payment is flagged for review, not accepted", async () => {
    order.reservationExpiresAt = PAST();
    await releaseExpiredRazorpayReservations();
    await sendWebhook("payment.authorized", payment({ status: "authorized" }), "evt_auth");
    assert.equal(order.paymentStatus, "expired");
    assert.equal(order.paymentReviewRequired, true);
    assert.equal(order.paymentReviewReason, "authorized_on_closed_order");
    assert.equal(order.razorpayPaymentId, PAY_A);
});

test("the sweeper flags an order that expires while a payment is authorized", async () => {
    await sendWebhook("payment.authorized", payment({ status: "authorized" }), "evt_auth");
    order.reservationExpiresAt = PAST();
    await releaseExpiredRazorpayReservations();
    assert.equal(order.paymentStatus, "expired");
    assert.equal(order.paymentReviewReason, "authorized_on_closed_order");
});

// Admin review resolution
test("an admin cannot clear a stock hold by acknowledging it, and release needs real stock", async () => {
    order.reservationHeld = false;
    order.paymentStatus = "expired";
    variants.v1 = { stockOnHand: 1, reserved: 0, active: true };
    await capture("evt_c1");
    assert.equal(order.fulfillmentHold, true);

    const ack = await review("acknowledge");
    assert.equal(ack.statusCode, 409);
    assert.equal(ack.body.code, "ACKNOWLEDGE_NOT_ALLOWED");
    assert.equal(order.fulfillmentHold, true);

    const noStock = await review("release");
    assert.equal(noStock.statusCode, 409);
    assert.equal(noStock.body.code, "STOCK_UNAVAILABLE");
    assert.equal(order.fulfillmentHold, true);

    const noReason = await review("release", "no");
    assert.equal(noReason.statusCode, 400);
    assert.equal(noReason.body.code, "REASON_REQUIRED");

    variants.v1.stockOnHand = 4;
    const released = await review("release", "Stock received from the weaver");
    assert.equal(released.statusCode, 200);
    assert.equal(order.fulfillmentHold, false);
    assert.equal(order.paymentReviewRequired, false);
    assert.equal(variants.v1.stockOnHand, 2, "release takes the stock exactly once");
    const entry = order.statusHistory.at(-1);
    assert.equal(entry.actor, "admin");
    assert.match(entry.note, /Stock received from the weaver/);
    assert.equal(isEligibleForPrepaidFulfillment(order), true);
    assert.equal((await review("release")).body.code, "NO_REVIEW_PENDING");
});

test("a duplicate-payment review can be acknowledged but never releases or takes stock", async () => {
    await capture("evt_c1");
    await capture("evt_c2", payment({ id: PAY_B }));
    const before = structuredClone(variants);
    assert.equal((await review("release")).body.code, "REVIEW_NOT_RELEASABLE");
    const blocked = await review("acknowledge", "Second payment refunded in the Razorpay dashboard");
    assert.equal(blocked.body.code, "ADDITIONAL_PAYMENT_UNREFUNDED", "an unrefunded extra payment keeps the hold");
    assert.equal(order.fulfillmentHold, true);
    order.refunds.push({ refundId: "rfnd_B", paymentId: PAY_B, amountPaise: 250000, status: "processed" });
    const ack = await review("acknowledge", "Second payment refunded in the Razorpay dashboard");
    assert.equal(ack.statusCode, 200);
    assert.equal(order.fulfillmentHold, false);
    assert.deepEqual(variants, before);
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.refundedPaise, 0, "acknowledging is not a refund");
});

test("release is refused for shipped, cancelled, refunded or evidence-less orders and leaves stock and hold untouched", async () => {
    order.reservationHeld = false;
    order.paymentStatus = "expired";
    variants.v1 = { stockOnHand: 1, reserved: 0, active: true };
    await capture("evt_c1");
    variants.v1.stockOnHand = 4;
    const snapshot = structuredClone(variants);

    order.razorpayPaymentId = "";
    assert.equal((await review("release")).body.code, "REVIEW_NOT_RELEASABLE");
    order.razorpayPaymentId = PAY_A;

    order.status = "Shipped";
    assert.equal((await review("release")).body.code, "REVIEW_NOT_RELEASABLE");
    order.status = "Cancelled";
    assert.equal((await review("release")).body.code, "REVIEW_NOT_RELEASABLE");
    order.status = "Order Placed";

    order.paymentStatus = "refunded";
    assert.equal((await review("release")).body.code, "REVIEW_NOT_RELEASABLE");
    order.paymentStatus = "paid";

    assert.equal(order.fulfillmentHold, true);
    assert.deepEqual(variants, snapshot);
});

// Central policy
test("the payment transition table allows exactly the documented moves", () => {
    assert.deepEqual(Object.keys(PAYMENT_TRANSITIONS).sort(),
        ["authorized", "cod_pending", "expired", "failed", "paid", "pending", "refunded"]);
    assert.equal(canTransitionPayment("failed", "pending"), true);
    assert.equal(canTransitionPayment("expired", "paid"), true);
    for (const [from, to] of [["expired", "pending"], ["expired", "failed"], ["paid", "failed"],
        ["paid", "pending"], ["refunded", "paid"], ["pending", "refunded"], ["authorized", "pending"]]) {
        assert.equal(canTransitionPayment(from, to), false, `${from} -> ${to}`);
    }
    const sample = makeOrder({ paymentStatus: "paid" });
    assert.throws(() => transitionPayment(sample, "failed"), { code: "INVALID_PAYMENT_TRANSITION" });
    assert.equal(sample.paymentStatus, "paid");
    assert.equal(transitionPayment(sample, "paid"), false);
});

test("applyPaymentAttempt never releases stock, never extends a deadline and ignores terminal orders", () => {
    const open = makeOrder();
    const deadline = open.reservationExpiresAt;
    assert.equal(applyPaymentAttempt(open, payment({ status: "failed" }), "failed"), "recorded");
    assert.equal(applyPaymentAttempt(open, payment({ status: "failed" }), "failed"), "unchanged");
    assert.equal(open.reservationHeld, true);
    assert.equal(open.reservationExpiresAt, deadline);
    for (const paymentStatus of ["paid", "refunded"]) {
        const done = makeOrder({ paymentStatus });
        assert.equal(applyPaymentAttempt(done, payment(), "failed"), "ignored");
        assert.equal(done.paymentStatus, paymentStatus);
    }
    const closed = makeOrder({ status: "Cancelled", reservationHeld: false, paymentStatus: "expired" });
    assert.equal(applyPaymentAttempt(closed, payment(), "failed"), "ignored");
    assert.equal(closed.paymentStatus, "expired");
});

test("getPaymentBlock covers every non-payable state with a stable code", () => {
    const code = overrides => getPaymentBlock(makeOrder(overrides))?.code ?? null;
    assert.equal(code({}), null);
    assert.equal(code({ status: "Cancelled" }), "ORDER_CANCELLED");
    assert.equal(code({ paymentStatus: "paid" }), "ORDER_ALREADY_PAID");
    assert.equal(code({ paymentStatus: "refunded" }), "ORDER_ALREADY_PAID");
    assert.equal(code({ status: "Shipped" }), "ORDER_NOT_PAYABLE");
    assert.equal(code({ status: "Return Approved" }), "ORDER_NOT_PAYABLE");
    assert.equal(code({ fulfillmentHold: true }), "PAYMENT_REVIEW_REQUIRED");
    assert.equal(code({ paymentReviewRequired: true }), "PAYMENT_REVIEW_REQUIRED");
    assert.equal(code({ paymentStatus: "expired" }), "PAYMENT_WINDOW_EXPIRED");
    assert.equal(code({ paymentStatus: "authorized" }), "PAYMENT_IN_PROGRESS");
    assert.equal(code({ razorpaySetupStatus: "creating" }), "PAYMENT_SETUP_INCOMPLETE");
    assert.equal(code({ reservationExpiresAt: PAST() }), "PAYMENT_WINDOW_EXPIRED");
    assert.equal(code({ paymentStatus: "failed", reservationHeld: false }), "PAYMENT_RESERVATION_RELEASED");
    assert.equal(getPaymentBlock(makeOrder({ paymentStatus: "failed", reservationHeld: false }), { allowReacquire: true }), null);
});
