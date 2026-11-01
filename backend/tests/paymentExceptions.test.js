import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { afterEach, beforeEach, mock } from "node:test";
import mongoose from "mongoose";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import productVariantModel from "../models/productVariantModel.js";
import razorpayWebhookEventModel from "../models/razorpayWebhookEventModel.js";
import notificationEventModel from "../models/notificationEventModel.js";
import paymentAnomalyModel from "../models/paymentAnomalyModel.js";
import { reconciliationRunModel } from "../models/reconciliationRunModel.js";
import { processCapturedPayment, razorpayGateway, razorpayWebhook } from "../controllers/razorpayController.js";
import { initiateRefund } from "../controllers/refundController.js";
import { resolvePaymentReview } from "../controllers/orderController.js";
import {
    listAnomalies,
    paymentReviewDetail,
    reconciliationHistory,
    setAnomalyStatus
} from "../controllers/anomalyController.js";
import { removePurchasedFromCart } from "../utils/cartPurchase.js";
import { serializeCustomerOrder } from "../utils/orderSerializers.js";
import { refundTotals } from "../utils/refunds.js";

// Mocked only: stubbed models and a fake Razorpay gateway drive the real controllers and policy code. These do
// not prove real MongoDB transaction behaviour or real Razorpay responses.
const KEY_SECRET = "test_key_secret_value";
const WEBHOOK_SECRET = "test_webhook_secret_value";
const ENV_KEYS = ["RAZORPAY_MODE", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
const ORDER_ID = "665f1c2e8f1b2c0012345678";
const ANOMALY_ID = "665f1c2e8f1b2c00aaaaaaaa";
const USER_ID = "665f1c2e8f1b2c0087654321";
const RZP_ORDER = "order_TEST0001";
const PAY_A = "pay_AAAA0001";
const PAY_B = "pay_BBBB0002";
const TOTAL = 250000;
const key = n => `123e4567-e89b-42d3-a456-42661417400${n}`;

let savedEnv;
let order;
let variants;
let webhookEventIds;
let gw;
let calls;
let anomalyStore;
let openMismatches;
let cart;
let orderReads;

const query = value => ({
    session() { return this; },
    select() { return this; },
    sort() { return this; },
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
        totalPaise: TOTAL,
        razorpayOrderId: RZP_ORDER,
        razorpayPaymentId: "",
        reservationHeld: true,
        reservationExpiresAt: new Date(Date.now() + 600000),
        fulfillmentHold: false,
        paymentReviewRequired: false,
        paymentReviewReason: "",
        refundedPaise: 0,
        refunds: [],
        capturedPayments: [],
        duplicatePaymentIds: Object.assign([], { addToSet(id) { if (!this.includes(id)) this.push(id); } }),
        statusHistory: [],
        reconciliation: { attempts: 2, lastAttemptAt: new Date(), lastOutcome: "mismatch", lastDetail: "x" },
        whatsappOptIn: false,
        address: { firstName: "Asha", lastName: "K", email: "asha@example.com", phone: "9876543210" },
        items: [{ variantId: "v1", productId: "p1", quantity: 2, name: "Saree", sku: "S1" }],
        ...overrides
    };
    data.save = async () => data;
    return data;
};
const paidOrder = (overrides = {}) => makeOrder({
    paymentStatus: "paid", payment: true, razorpayPaymentId: PAY_A, reservationHeld: false, ...overrides
});
// A paid order with a second captured payment on review.
const duplicateOrder = (overrides = {}) => paidOrder({
    fulfillmentHold: true, paymentReviewRequired: true, paymentReviewReason: "duplicate_payment",
    duplicatePaymentIds: Object.assign([PAY_B], { addToSet(id) { if (!this.includes(id)) this.push(id); } }),
    ...overrides
});
const mismatchOrder = (overrides = {}) => makeOrder({
    paymentReviewRequired: true, paymentReviewReason: "payment_mismatch", reservationHeld: false, ...overrides
});

const matchesFilter = (doc, filter) => Object.entries(filter).every(([k, value]) =>
    k === "$or" ? value.some(part => matchesFilter(doc, part)) : String(doc[k]) === String(value));
const clone = value => Array.isArray(value) ? structuredClone([...value]) : structuredClone(value);
const snapshot = doc => Object.fromEntries(Object.entries(doc)
    .filter(([, value]) => typeof value !== "function").map(([k, value]) => [k, clone(value)]));
const restore = (doc, saved) => {
    for (const [k, value] of Object.entries(saved)) {
        if (Array.isArray(doc[k])) doc[k].splice(0, doc[k].length, ...value);
        else doc[k] = value;
    }
};
const jsonResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const gwPayment = (overrides = {}) => ({
    id: PAY_A, order_id: RZP_ORDER, amount: TOTAL, currency: "INR", status: "captured", amount_refunded: 0, created_at: 1, ...overrides
});
const gwRefund = (overrides = {}) => ({
    id: "rfnd_0001", payment_id: PAY_A, amount: TOTAL, currency: "INR", status: "pending", ...overrides
});

const signedWebhook = (payload, eventId) => {
    const body = Buffer.from(JSON.stringify(payload));
    const headers = {
        "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex"),
        "x-razorpay-event-id": eventId
    };
    return { body, get: name => headers[name.toLowerCase()] };
};
const refundWebhook = async (event, refund, eventId, paymentEntity) => {
    const res = jsonResponse();
    await razorpayWebhook(signedWebhook({
        event,
        payload: { refund: { entity: refund }, payment: { entity: paymentEntity || { id: refund.payment_id, order_id: RZP_ORDER } } }
    }, eventId), res);
    return res;
};

const requestRefund = async (body = {}) => {
    const res = jsonResponse();
    await initiateRefund({
        body: { orderId: ORDER_ID, amountPaise: TOTAL, reason: "Customer was charged twice", idempotencyKey: key(1), ...body }
    }, res);
    return res;
};
const review = async (action, reason = "Checked with the customer and Razorpay") => {
    const res = jsonResponse();
    await resolvePaymentReview({ body: { orderId: ORDER_ID, action, reason } }, res);
    return res;
};
const lastRefund = () => order.refunds[order.refunds.length - 1];

// Emulates the conditional cart updates cartPurchase.js issues, against an in-memory saved cart.
const cartPath = path => path.replace("cartData.", "").split(".");
const readPath = path => {
    const [p, v] = cartPath(path);
    return v === undefined ? cart[p] : cart[p]?.[v];
};
const matchesCartFilter = filter => Object.entries(filter).every(([k, cond]) => {
    if (k === "_id") return true;
    const value = readPath(k);
    if (cond && typeof cond === "object" && Object.keys(cond).length === 0) {
        return value !== undefined && typeof value === "object" && Object.keys(value).length === 0;
    }
    if (cond.$gt !== undefined) return typeof value === "number" && value > cond.$gt;
    if (cond.$lte !== undefined) return typeof value === "number" && value <= cond.$lte;
    return false;
});
const applyCartUpdate = (filter, update) => {
    if (!matchesCartFilter(filter)) return { matchedCount: 0 };
    for (const [path, delta] of Object.entries(update.$inc || {})) {
        const [p, v] = cartPath(path);
        cart[p][v] += delta;
    }
    for (const path of Object.keys(update.$unset || {})) {
        const [p, v] = cartPath(path);
        if (v === undefined) delete cart[p];
        else delete cart[p]?.[v];
    }
    return { matchedCount: 1 };
};

const matchAnomaly = (doc, filter) => Object.entries(filter).every(([k, cond]) => {
    if (k === "_id") return String(doc._id) === String(cond);
    const value = doc[k] ?? null;
    if (cond && cond.$in) return cond.$in.includes(value);
    return value === cond;
});

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    Object.assign(process.env, {
        RAZORPAY_MODE: "test",
        RAZORPAY_KEY_ID: "rzp_test_fakekeyid",
        RAZORPAY_KEY_SECRET: KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET
    });
    order = makeOrder();
    variants = { v1: { stockOnHand: 5, reserved: 2, active: true } };
    webhookEventIds = new Set();
    anomalyStore = [];
    openMismatches = 0;
    cart = {};
    orderReads = 0;
    calls = { refund: 0 };
    gw = {
        payments: {
            fetch: async id => gwPayment({ id }),
            refund: async (paymentId, params) => {
                calls.refund += 1;
                return gwRefund({ id: `rfnd_${calls.refund}`, payment_id: paymentId, amount: params.amount, notes: params.notes });
            }
        }
    };
    mock.method(razorpayGateway, "client", () => gw);
    mock.method(mongoose, "startSession", async () => ({
        async withTransaction(fn) {
            const savedOrder = snapshot(order);
            const savedVariants = structuredClone(variants);
            const savedCart = structuredClone(cart);
            try { return await fn(); } catch (error) {
                restore(order, savedOrder);
                variants = savedVariants;
                cart = savedCart;
                throw error;
            }
        },
        async endSession() {}
    }));
    mock.method(orderModel, "findOne", filter => { orderReads += 1; return query(matchesFilter(order, filter) ? order : null); });
    mock.method(orderModel, "findById", id => { orderReads += 1; return query(String(id) === ORDER_ID ? order : null); });
    mock.method(razorpayWebhookEventModel, "create", async ([doc]) => {
        if (webhookEventIds.has(doc.eventId)) throw Object.assign(new Error("E11000"), { code: 11000 });
        webhookEventIds.add(doc.eventId);
    });
    mock.method(paymentAnomalyModel, "updateOne", async (filter, update) => {
        if (filter._id) {
            const doc = anomalyStore.find(item => matchAnomaly(item, filter));
            if (!doc) return { matchedCount: 0 };
            Object.assign(doc, update.$set);
            doc.history.push(update.$push.history);
            return { matchedCount: 1 };
        }
        anomalyStore.push({ _id: `an${anomalyStore.length}`, history: [], ...update.$setOnInsert });
        return {};
    });
    mock.method(paymentAnomalyModel, "findById", id => query(anomalyStore.find(item => String(item._id) === String(id)) || null));
    mock.method(paymentAnomalyModel, "find", filter => {
        let rows = [...anomalyStore];
        if (filter.investigationStatus) rows = rows.filter(row => matchAnomaly(row, { investigationStatus: filter.investigationStatus }));
        if (filter.$or && filter.$or.some(part => part.investigationStatus === "open")) {
            rows = rows.filter(row => (row.investigationStatus || "open") === "open");
        }
        return query(rows);
    });
    mock.method(paymentAnomalyModel, "countDocuments", async () => openMismatches);
    mock.method(userModel, "updateOne", async (filter, update) => applyCartUpdate(filter, update));
    mock.method(productVariantModel, "exists", filter => {
        const variant = variants[filter._id];
        return query(Boolean(variant) && variant.reserved >= filter.reserved.$gte && variant.stockOnHand >= filter.stockOnHand.$gte);
    });
    mock.method(productVariantModel, "updateOne", async (filter, update) => {
        const variant = variants[filter._id];
        if (!variant || (filter.reserved?.$gte !== undefined && variant.reserved < filter.reserved.$gte) ||
            (filter.stockOnHand?.$gte !== undefined && variant.stockOnHand < filter.stockOnHand.$gte)) return { modifiedCount: 0 };
        for (const [field, delta] of Object.entries(update.$inc)) variant[field] += delta;
        return { modifiedCount: 1 };
    });
    mock.method(notificationEventModel, "updateOne", async () => ({ upsertedCount: 1 }));
    mock.method(notificationEventModel, "find", () => ({ sort() { return this; }, limit() { return this; }, lean: async () => [] }));
    mock.method(console, "error", () => {});
});

afterEach(() => {
    mock.restoreAll();
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
});

// ------------------------------------------------------- payment-specific refunds

test("payment mismatch recovery: the exact payment is fetched, verified, refunded on its own balance, and the hold stays", async () => {
    order = mismatchOrder();
    gw.payments.fetch = async id => gwPayment({ id, amount: 123456 });
    const res = await requestRefund({ paymentId: PAY_B, amountPaise: 123456 });
    assert.equal(res.statusCode, 201);
    assert.equal(calls.refund, 1);
    assert.equal(lastRefund().paymentId, PAY_B);
    assert.equal(lastRefund().status, "pending");
    assert.deepEqual(order.capturedPayments.map(({ paymentId, amountPaise }) => ({ paymentId, amountPaise })),
        [{ paymentId: PAY_B, amountPaise: 123456 }]);
    assert.equal(order.paymentReviewRequired, true, "a refund does not clear the review");
    assert.equal(order.paymentStatus, "pending", "the order's own payment state is not touched");
    assert.equal(order.refundedPaise, 0);
    const balance = res.body.paymentBalances.find(item => item.paymentId === PAY_B);
    assert.equal(balance.capturedPaise, 123456);
    assert.equal(balance.remainingPaise, 0);
});

test("a payment can only be refunded when Razorpay binds it to this order, captured, in INR", async () => {
    order = mismatchOrder();
    const attempt = async overrides => {
        gw.payments.fetch = async id => gwPayment({ id, amount: 100000, ...overrides });
        return requestRefund({ paymentId: PAY_B, amountPaise: 100000 });
    };
    assert.equal((await attempt({ order_id: "order_OTHER" })).body.code, "PAYMENT_NOT_CAPTURED");
    assert.equal((await attempt({ order_id: undefined })).body.code, "PAYMENT_NOT_CAPTURED");
    assert.equal((await attempt({ status: "authorized" })).body.code, "PAYMENT_NOT_CAPTURED");
    assert.equal((await attempt({ currency: "USD" })).body.code, "PAYMENT_NOT_CAPTURED");
    assert.equal((await attempt({ id: "pay_SOMEONE_ELSE" })).body.code, "PAYMENT_NOT_CAPTURED");
    assert.equal(calls.refund, 0);
    assert.equal(order.refunds.length, 0);
    assert.equal(order.capturedPayments.length, 0, "nothing is registered from unverified evidence");
});

test("an order that is not under review cannot be used to refund an unrelated payment", async () => {
    order = paidOrder();
    const res = await requestRefund({ paymentId: PAY_B, amountPaise: 1000 });
    assert.equal(res.body.code, "PAYMENT_NOT_ON_ORDER");
    assert.equal(calls.refund, 0);
});

test("a secondary payment refund is capped by that payment's own amount, not the order total", async () => {
    order = mismatchOrder();
    gw.payments.fetch = async id => gwPayment({ id, amount: 100000 });
    const over = await requestRefund({ paymentId: PAY_B, amountPaise: 100001 });
    assert.equal(over.body.code, "REFUND_EXCEEDS_CAPTURED");
    assert.equal((await requestRefund({ paymentId: PAY_B, amountPaise: 60000, idempotencyKey: key(2) })).statusCode, 201);
    const second = await requestRefund({ paymentId: PAY_B, amountPaise: 60000, idempotencyKey: key(3) });
    assert.equal(second.body.code, "REFUND_EXCEEDS_CAPTURED", "pending refunds count against the payment");
    assert.equal(calls.refund, 1);
});

test("duplicate payment isolation: refunding the extra payment never touches the primary payment or marks the order refunded", async () => {
    order = duplicateOrder();
    const res = await requestRefund({ paymentId: PAY_B });
    assert.equal(res.statusCode, 201);
    const record = lastRefund();
    await refundWebhook("refund.processed", gwRefund({ id: record.refundId, payment_id: PAY_B, amount: TOTAL, status: "processed", notes: { pshRefundId: record.internalId } }), "evt_b1");
    assert.equal(lastRefund().status, "processed");
    assert.equal(order.refundedPaise, 0, "the primary payment's refunded amount is unchanged");
    assert.equal(order.paymentStatus, "paid", "one refunded payment is not a refunded order");
    assert.equal(order.fulfillmentHold, true, "the hold stays until a human resolves the review");
    assert.equal(refundTotals(order, PAY_A).processedPaise, 0);
    assert.equal(refundTotals(order, PAY_B).processedPaise, TOTAL);
});

test("the order is only marked refunded once every verified captured payment is refunded", async () => {
    order = duplicateOrder();
    await requestRefund({ paymentId: PAY_B, idempotencyKey: key(2) });
    const b = lastRefund();
    await requestRefund({ amountPaise: TOTAL, idempotencyKey: key(3) });
    const a = lastRefund();
    await refundWebhook("refund.processed", gwRefund({ id: a.refundId, payment_id: PAY_A, status: "processed", notes: { pshRefundId: a.internalId } }), "evt_a1");
    assert.equal(order.refundedPaise, TOTAL);
    assert.equal(order.paymentStatus, "paid", "the extra payment is still unrefunded");
    await refundWebhook("refund.processed", gwRefund({ id: b.refundId, payment_id: PAY_B, status: "processed", notes: { pshRefundId: b.internalId } }), "evt_b2");
    assert.equal(order.paymentStatus, "refunded");
    assert.equal(order.fulfillmentHold, true, "even a full refund never clears the hold");
});

test("a repeated payment-specific refund request is a replay and reaches Razorpay once", async () => {
    order = mismatchOrder();
    gw.payments.fetch = async id => gwPayment({ id, amount: 90000 });
    await requestRefund({ paymentId: PAY_B, amountPaise: 90000 });
    const again = await requestRefund({ paymentId: PAY_B, amountPaise: 90000 });
    assert.equal(again.body.replayed, true);
    assert.equal(calls.refund, 1);
    assert.equal(order.refunds.length, 1);
    assert.equal(order.capturedPayments.length, 1, "the payment is registered once");
});

test("cancelled-order late capture: the captured payment can be refunded while the hold and stock stay untouched", async () => {
    order = paidOrder({ status: "Cancelled", fulfillmentHold: true, paymentReviewRequired: true, paymentReviewReason: "order_cancelled" });
    const before = structuredClone(variants);
    const res = await requestRefund();
    assert.equal(res.statusCode, 201);
    await refundWebhook("refund.processed", gwRefund({ id: lastRefund().refundId, status: "processed", notes: { pshRefundId: lastRefund().internalId } }), "evt_c1");
    assert.equal(order.paymentStatus, "refunded");
    assert.equal(order.fulfillmentHold, true);
    assert.equal(order.status, "Cancelled");
    assert.deepEqual(variants, before, "a refund never restocks");
});

test("a refund webhook for a payment that was never verified and registered is not attached to the order", async () => {
    order = mismatchOrder();
    await refundWebhook("refund.processed", gwRefund({ id: "rfnd_X", payment_id: PAY_B, amount: 5000, status: "processed" }), "evt_x");
    assert.equal(order.refunds.length, 0);
    assert.equal(order.refundedPaise, 0);
});

// ------------------------------------------------------- review resolution

test("every review resolution needs a reason, and invalid actions are rejected", async () => {
    order = duplicateOrder();
    assert.equal((await review("acknowledge", "no")).body.code, "REASON_REQUIRED");
    assert.equal((await review("clear")).body.code, "INVALID_REQUEST");
    assert.equal(order.fulfillmentHold, true);
});

test("a cancelled order's review cannot be acknowledged until the payment is confirmed refunded", async () => {
    order = paidOrder({ status: "Cancelled", fulfillmentHold: true, paymentReviewRequired: true, paymentReviewReason: "order_cancelled" });
    const blocked = await review("acknowledge");
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.body.code, "REFUND_REQUIRED");
    assert.equal(order.fulfillmentHold, true);
    assert.equal((await review("release")).body.code, "REVIEW_NOT_RELEASABLE");
    order.paymentStatus = "refunded";
    const ok = await review("acknowledge", "Refund confirmed processed in Razorpay");
    assert.equal(ok.statusCode, 200);
    assert.equal(order.status, "Cancelled", "a cancelled order is never reopened");
});

test("a payment mismatch review stays on hold while its evidence is unresolved, and records the acting admin", async () => {
    order = mismatchOrder();
    openMismatches = 1;
    assert.equal((await review("acknowledge")).body.code, "MISMATCH_UNRESOLVED");
    assert.equal(order.paymentReviewRequired, true);
    openMismatches = 0;
    const ok = await review("acknowledge", "Mismatched payment refunded and anomaly resolved");
    assert.equal(ok.statusCode, 200);
    assert.equal(order.paymentReviewRequired, false);
    const entry = order.statusHistory.at(-1);
    assert.equal(entry.actor, "admin");
    assert.match(entry.note, /payment_mismatch.*Mismatched payment refunded/);
    assert.equal(order.paymentStatus, "pending", "resolving a review never marks the order paid");
});

test("the review detail endpoint reports only actions the backend will accept, plus linked evidence", async () => {
    order = mismatchOrder();
    anomalyStore.push({
        _id: ANOMALY_ID, kind: "captured_payment_mismatch", source: "reconciliation", orderId: ORDER_ID,
        razorpayOrderId: RZP_ORDER, paymentId: PAY_B, amountPaise: 123456, currency: "INR", history: []
    });
    const res = jsonResponse();
    await paymentReviewDetail({ body: { orderId: ORDER_ID } }, res);
    assert.equal(res.body.anomalies[0].paymentId, PAY_B);
    assert.equal(res.body.anomalies[0].investigationStatus, "open");
    assert.equal(res.body.review.stockDeducted, false);
    assert.equal(res.body.review.release.allowed, false);
    assert.equal(res.body.review.reservationHeld, false);
    assert.equal(res.body.reconciliation.attempts, 2);
    const bad = jsonResponse();
    await paymentReviewDetail({ body: { orderId: "nope" } }, bad);
    assert.equal(bad.statusCode, 400);
});

// ------------------------------------------------------- anomaly workflow

const seedAnomaly = (overrides = {}) => {
    anomalyStore.push({
        _id: ANOMALY_ID, kind: "captured_payment_mismatch", source: "reconciliation", orderId: ORDER_ID,
        paymentId: PAY_B, history: [], lastSeenAt: new Date(), ...overrides
    });
};
const setStatus = async body => {
    const res = jsonResponse();
    await setAnomalyStatus({ body: { anomalyId: ANOMALY_ID, reason: "Checked in the Razorpay dashboard", ...body } }, res);
    return res;
};

test("anomaly status changes need a valid status, a reason and an allowed transition", async () => {
    seedAnomaly();
    assert.equal((await setStatus({ status: "closed" })).body.code, "INVALID_STATUS");
    assert.equal((await setStatus({ status: "resolved", reason: "ok" })).body.code, "REASON_REQUIRED");
    assert.equal((await setStatus({ anomalyId: "bad", status: "resolved" })).body.code, "INVALID_ANOMALY");
    assert.equal((await setStatus({ status: "open" })).body.code, "NO_CHANGE");
    assert.equal(anomalyStore[0].history.length, 0, "rejected changes leave no audit entry");
});

test("an anomaly moves open -> investigating -> resolved -> reopened with a full audit trail", async () => {
    seedAnomaly();
    assert.equal((await setStatus({ status: "investigating", reason: "Looking at the dashboard" })).body.anomaly.investigationStatus, "investigating");
    const resolved = await setStatus({ status: "resolved", reason: "Refund processed, customer informed" });
    assert.equal(resolved.body.anomaly.investigationStatus, "resolved");
    assert.equal(resolved.body.anomaly.resolution, "Refund processed, customer informed");
    assert.ok(resolved.body.anomaly.resolvedAt);
    assert.equal((await setStatus({ status: "investigating" })).body.code, "INVALID_TRANSITION");
    const reopened = await setStatus({ status: "open", reason: "Seen again after resolution" });
    assert.equal(reopened.body.anomaly.investigationStatus, "open");
    assert.equal(reopened.body.anomaly.resolution, "");
    assert.deepEqual(anomalyStore[0].history.map(entry => [entry.from, entry.to, entry.actor]),
        [["open", "investigating", "admin"], ["investigating", "resolved", "admin"], ["resolved", "open", "admin"]]);
});

test("resolving an anomaly changes nothing about the order, its payment, its stock or its refunds", async () => {
    order = duplicateOrder();
    seedAnomaly();
    const orderBefore = JSON.stringify(snapshot(order));
    const stockBefore = structuredClone(variants);
    const res = await setStatus({ status: "resolved" });
    assert.equal(res.statusCode, 200);
    assert.equal(orderReads, 0, "the order is never even read");
    assert.equal(JSON.stringify(snapshot(order)), orderBefore);
    assert.deepEqual(variants, stockBefore);
    assert.equal(calls.refund, 0);
});

test("a concurrent status change is refused instead of overwritten", async () => {
    seedAnomaly();
    mock.method(paymentAnomalyModel, "findById", id => {
        const result = query({ ...anomalyStore.find(item => String(item._id) === String(id)) });
        // Another admin moves it after this request read the document.
        anomalyStore[0].investigationStatus = "investigating";
        return result;
    });
    const res = await setStatus({ status: "resolved" });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "STATUS_CHANGED");
    assert.equal(anomalyStore[0].history.length, 0);
});

test("legacy anomalies without a status are treated as open, and listing is filtered and bounded", async () => {
    seedAnomaly({ _id: "an1" });
    seedAnomaly({ _id: "an2", investigationStatus: "resolved" });
    const res = jsonResponse();
    await listAnomalies({ body: { status: "open", limit: 500 } }, res);
    assert.deepEqual(res.body.anomalies.map(item => item.id), ["an1"]);
    assert.equal(res.body.anomalies[0].investigationStatus, "open");
    const bad = jsonResponse();
    await listAnomalies({ body: { status: "weird" } }, bad);
    assert.equal(bad.statusCode, 400);
});

// ------------------------------------------------------- reconciliation history

test("reconciliation history reports recent runs without their per-order results", async () => {
    let selected;
    mock.method(reconciliationRunModel, "find", () => ({
        sort() { return this; },
        limit() { return this; },
        select(fields) { selected = fields; return this; },
        lean: async () => [
            { _id: "r1", trigger: "admin", actor: "admin", status: "aborted", startedAt: new Date(), examined: 3, counts: { settled: 1, mismatch: 1 }, abortReason: "rate_limited" },
            { _id: "r2", trigger: "scheduled", actor: "scheduler", status: "completed", startedAt: new Date(), examined: 9, counts: {} }
        ]
    }));
    const res = jsonResponse();
    await reconciliationHistory({}, res);
    assert.equal(selected, "-results");
    assert.equal(res.body.runs[0].rateLimited, true);
    assert.equal(res.body.runs[1].rateLimited, false);
    assert.equal(res.body.runs[0].examined, 3);
});

// ------------------------------------------------------- cart preservation

const capturePayment = overrides => processCapturedPayment(gwPayment(overrides));

test("settlement removes only the purchased quantities and keeps everything else in the saved cart", async () => {
    cart = { p1: { v1: 5 }, p2: { v9: 1 } };
    order = makeOrder();
    await capturePayment();
    assert.equal(order.paymentStatus, "paid");
    assert.deepEqual(cart, { p1: { v1: 3 }, p2: { v9: 1 } }, "bought 2 of 5; the rest and other products stay");
});

test("a line bought in full is removed, and an emptied product is dropped, without touching new items", async () => {
    cart = { p1: { v1: 2 }, p2: { v9: 1 } };
    order = makeOrder();
    await capturePayment();
    assert.deepEqual(cart, { p2: { v9: 1 } });
});

test("items added after checkout started survive settlement", async () => {
    order = makeOrder();
    cart = { p1: { v1: 2 } };
    // The customer adds another size and a second unit after the order was created.
    cart.p1.v1 = 3;
    cart.p3 = { v3: 2 };
    await capturePayment();
    assert.deepEqual(cart, { p1: { v1: 1 }, p3: { v3: 2 } });
});

test("duplicate webhook and verification settlement cannot clear more of the cart", async () => {
    cart = { p1: { v1: 5 }, p2: { v9: 1 } };
    order = makeOrder();
    await capturePayment();
    await capturePayment();
    await processCapturedPayment(gwPayment({ id: PAY_B }));
    assert.deepEqual(cart.p1, { v1: 3 }, "the purchased quantity is removed exactly once");
    assert.deepEqual(cart.p2, { v9: 1 });
});

test("a late capture on a cancelled order does not touch the saved cart", async () => {
    cart = { p1: { v1: 5 } };
    order = makeOrder({ status: "Cancelled", reservationHeld: false });
    await capturePayment();
    assert.deepEqual(cart, { p1: { v1: 5 } });
});

test("removePurchasedFromCart ignores malformed ids and never writes operator-looking paths", async () => {
    cart = { p1: { v1: 4 } };
    const writes = [];
    mock.method(userModel, "updateOne", async (filter, update) => { writes.push(Object.keys(filter)); return applyCartUpdate(filter, update); });
    await removePurchasedFromCart(USER_ID, [
        { productId: "$where", variantId: "v1", quantity: 1 },
        { productId: "p1", variantId: "a.b", quantity: 1 },
        { productId: "p1", variantId: "v1", quantity: 0 },
        { productId: "p1", variantId: "v1", quantity: 1 }
    ]);
    assert.deepEqual(cart, { p1: { v1: 3 } });
    assert.ok(writes.every(keys => keys.every(name => name === "_id" || /^cartData\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?$/.test(name))));
});

// ------------------------------------------------------- customer wording

test("customers see a coarse payment issue and refund status, never reason codes, gateway data or ids", () => {
    const view = overrides => serializeCustomerOrder(makeOrder({ razorpayPaymentId: PAY_A, ...overrides }));
    const cases = [
        [{ paymentStatus: "paid", fulfillmentHold: true, paymentReviewRequired: true, paymentReviewReason: "stock_unavailable" }, "stock"],
        [{ paymentStatus: "paid", status: "Cancelled", fulfillmentHold: true, paymentReviewRequired: true, paymentReviewReason: "order_cancelled" }, "cancelled_capture"],
        [{ paymentStatus: "paid", fulfillmentHold: true, paymentReviewRequired: true, paymentReviewReason: "duplicate_payment" }, "duplicate"],
        [{ paymentReviewRequired: true, paymentReviewReason: "payment_mismatch" }, "review"],
        [{ paymentStatus: "paid" }, ""]
    ];
    for (const [overrides, expected] of cases) {
        const result = view(overrides);
        assert.equal(result.paymentIssue, expected);
        const text = JSON.stringify(result);
        assert.ok(!/payment_mismatch|stock_unavailable|duplicate_payment|order_cancelled|pay_AAAA|order_TEST|anomal/i.test(text), text);
    }
    const failed = view({ paymentStatus: "paid", refunds: [{ refundId: "rfnd_1", paymentId: PAY_A, amountPaise: 1000, status: "failed", failureReason: "bank said no" }] });
    assert.equal(failed.refundStatus, "failed");
    assert.ok(!JSON.stringify(failed).includes("bank said no"));
    const pending = view({ paymentStatus: "paid", refunds: [{ refundId: "rfnd_1", paymentId: PAY_A, amountPaise: 1000, status: "pending" }] });
    assert.equal(pending.refundStatus, "pending");
});
