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
import { reconciliationLockModel, reconciliationRunModel } from "../models/reconciliationRunModel.js";
import { razorpayGateway, razorpayWebhook } from "../controllers/razorpayController.js";
import { initiateRefund, syncRefunds } from "../controllers/refundController.js";
import { reconcileNow, reconcileScheduled } from "../controllers/reconciliationController.js";
import { reconcilePayments } from "../utils/paymentReconciliation.js";
import { serializeAdminOrder, serializeCustomerOrder } from "../utils/orderSerializers.js";
import { applyProcessedRefund } from "../utils/orderPayments.js";

// Mocked only: stubbed models and a fake Razorpay gateway drive the real controllers, refund policy and
// reconciliation service. These do not prove real MongoDB transaction or Razorpay API behaviour.
const KEY_SECRET = "test_key_secret_value";
const WEBHOOK_SECRET = "test_webhook_secret_value";
const ENV_KEYS = ["RAZORPAY_MODE", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RECONCILIATION_JOB_TOKEN"];
const ORDER_ID = "665f1c2e8f1b2c0012345678";
const USER_ID = "665f1c2e8f1b2c0087654321";
const RZP_ORDER = "order_TEST0001";
const PAY_A = "pay_AAAA0001";
const PAY_B = "pay_BBBB0002";
const TOTAL = 250000;
const key = n => `123e4567-e89b-42d3-a456-42661417400${n}`;
const PAST = () => new Date(Date.now() - 60 * 1000);

let savedEnv;
let order;
let variants;
let staged;
let webhookEventIds;
let anomalies;
let gw;
let calls;
let lockHeld;
let runs;

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
        reservationExpiresAt: PAST(),
        fulfillmentHold: false,
        paymentReviewRequired: false,
        paymentReviewReason: "",
        refundedPaise: 0,
        refunds: [],
        duplicatePaymentIds: Object.assign([], { addToSet(id) { if (!this.includes(id)) this.push(id); } }),
        statusHistory: [],
        reconciliation: { attempts: 0 },
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
const refundWebhook = async (event, refund, eventId, paymentEntity = { id: PAY_A, order_id: RZP_ORDER }) => {
    const res = jsonResponse();
    await razorpayWebhook(signedWebhook({ event, payload: { refund: { entity: refund }, payment: { entity: paymentEntity } } }, eventId), res);
    return res;
};

const requestRefund = async (body = {}) => {
    const res = jsonResponse();
    await initiateRefund({
        body: { orderId: ORDER_ID, amountPaise: TOTAL, reason: "Customer returned the saree", idempotencyKey: key(1), ...body }
    }, res);
    return res;
};
const syncNow = async () => {
    const res = jsonResponse();
    await syncRefunds({ body: { orderId: ORDER_ID } }, res);
    return res;
};

const pshId = () => order.refunds[order.refunds.length - 1].internalId;
const stockSnapshot = () => structuredClone(variants);

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    Object.assign(process.env, {
        RAZORPAY_MODE: "test",
        RAZORPAY_KEY_ID: "rzp_test_fakekeyid",
        RAZORPAY_KEY_SECRET: KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET
    });
    delete process.env.RECONCILIATION_JOB_TOKEN;
    order = makeOrder();
    variants = { v1: { stockOnHand: 5, reserved: 2, active: true } };
    staged = [];
    webhookEventIds = new Set();
    anomalies = [];
    calls = { refund: 0, fetchPayments: 0, fetchMultipleRefund: 0, fetchRefund: 0 };
    lockHeld = false;
    runs = [];
    gw = {
        payments: {
            fetch: async () => gwPayment(),
            refund: async (paymentId, params) => {
                calls.refund += 1;
                return gwRefund({ id: `rfnd_${calls.refund}`, payment_id: paymentId, amount: params.amount, receipt: params.receipt, notes: params.notes });
            },
            fetchRefund: async () => { calls.fetchRefund += 1; return gwRefund(); },
            fetchMultipleRefund: async () => { calls.fetchMultipleRefund += 1; return { items: [] }; }
        },
        orders: { fetchPayments: async () => { calls.fetchPayments += 1; return { items: [] }; } }
    };
    mock.method(razorpayGateway, "client", () => gw);

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
    mock.method(orderModel, "find", filter => {
        if (filter["refunds.status"]) {
            return query((order.refunds || []).some(r => ["requested", "pending"].includes(r.status)) ? [order] : []);
        }
        if (filter._id) return query(String(filter._id) === ORDER_ID ? [order] : []);
        const eligible = ["pending", "authorized", "failed", "expired"].includes(order.paymentStatus) ||
            (order.paymentStatus === "paid" && order.fulfillmentHold);
        return query(eligible ? [order] : []);
    });
    mock.method(orderModel, "updateOne", async (filter, update) => {
        order.reconciliation = { ...(order.reconciliation || {}), attempts: (order.reconciliation?.attempts || 0) + 1,
            lastAttemptAt: update.$set["reconciliation.lastAttemptAt"], lastOutcome: update.$set["reconciliation.lastOutcome"] };
        return { modifiedCount: 1 };
    });
    mock.method(razorpayWebhookEventModel, "create", async ([doc]) => {
        if (webhookEventIds.has(doc.eventId)) throw Object.assign(new Error("E11000"), { code: 11000 });
        webhookEventIds.add(doc.eventId);
    });
    mock.method(paymentAnomalyModel, "updateOne", async (filter, update) => { anomalies.push(update.$setOnInsert); return {}; });
    mock.method(reconciliationLockModel, "findOneAndUpdate", async () => {
        if (lockHeld) throw Object.assign(new Error("E11000"), { code: 11000 });
        lockHeld = true;
        return {};
    });
    mock.method(reconciliationLockModel, "updateOne", async () => { lockHeld = false; return {}; });
    mock.method(reconciliationRunModel, "create", async doc => { runs.push(doc); return { _id: "run1" }; });
    mock.method(reconciliationRunModel, "updateOne", async () => ({}));
    mock.method(userModel, "updateOne", async () => ({ modifiedCount: 1 }));
    mock.method(productVariantModel, "exists", filter => {
        const variant = variants[filter._id];
        return query(Boolean(variant) && variant.reserved >= filter.reserved.$gte && variant.stockOnHand >= filter.stockOnHand.$gte);
    });
    mock.method(productVariantModel, "updateOne", async (filter, update) => ({ modifiedCount: applyVariantUpdate(filter, update) }));
    mock.method(notificationEventModel, "updateOne", async (filter, update) => {
        if (staged.some(item => item.dedupeKey === filter.dedupeKey)) return { upsertedCount: 0 };
        staged.push(update.$setOnInsert);
        return { upsertedCount: 1 };
    });
    mock.method(notificationEventModel, "find", () => ({ sort() { return this; }, limit() { return this; }, lean: async () => [] }));
    mock.method(console, "error", () => {});
});

afterEach(() => {
    for (const [id, v] of Object.entries(variants)) {
        assert.ok(v.stockOnHand >= 0 && v.reserved >= 0 && v.reserved <= v.stockOnHand, `${id} stock invariant`);
    }
    mock.restoreAll();
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
});

// ---------------------------------------------------------------- refund initiation

test("a full refund request is stored, sent to Razorpay as pending, and never marks the order refunded", async () => {
    order = paidOrder();
    const res = await requestRefund();
    assert.equal(res.statusCode, 201);
    assert.equal(calls.refund, 1);
    assert.equal(order.refunds[0].status, "pending");
    assert.equal(order.refunds[0].refundId, "rfnd_1");
    assert.equal(order.refundedPaise, 0);
    assert.equal(order.paymentStatus, "paid", "the create call is not proof the refund finished");
    assert.equal(res.body.refundSummary.inFlightPaise, TOTAL);
    assert.equal(res.body.refunds[0].idempotencyKey, undefined, "idempotency keys are not sent to the browser");
});

test("a create response claiming processed is still recorded as pending until a webhook or sync confirms it", async () => {
    order = paidOrder();
    gw.payments.refund = async (paymentId, params) => gwRefund({ status: "processed", amount: params.amount, notes: params.notes });
    await requestRefund();
    assert.equal(order.refunds[0].status, "pending");
    assert.equal(order.refundedPaise, 0);
});

test("a partial refund is accepted and leaves the remainder refundable", async () => {
    order = paidOrder();
    const res = await requestRefund({ amountPaise: 100000 });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.refundSummary.remainingPaise, TOTAL - 100000);
});

test("multiple partial refunds are allowed until the captured amount is committed", async () => {
    order = paidOrder();
    assert.equal((await requestRefund({ amountPaise: 100000, idempotencyKey: key(1) })).statusCode, 201);
    assert.equal((await requestRefund({ amountPaise: 100000, idempotencyKey: key(2) })).statusCode, 201);
    const third = await requestRefund({ amountPaise: 100000, idempotencyKey: key(3) });
    assert.equal(third.statusCode, 409);
    assert.equal(third.body.code, "REFUND_EXCEEDS_CAPTURED");
    assert.equal(calls.refund, 2);
});

test("over-refund and invalid amounts are rejected before Razorpay is contacted", async () => {
    order = paidOrder();
    for (const amountPaise of [TOTAL + 1, 0, -5, 10.5, "100"]) {
        const res = await requestRefund({ amountPaise });
        assert.ok([400, 409].includes(res.statusCode), `amount ${amountPaise}`);
    }
    assert.equal((await requestRefund({ reason: "no" })).body.code, "REASON_REQUIRED");
    assert.equal(calls.refund, 0);
    assert.equal(order.refunds.length, 0);
});

test("refunds need a captured payment on a paid order and verified by Razorpay itself", async () => {
    order = makeOrder();
    assert.equal((await requestRefund()).body.code, "NO_CAPTURED_PAYMENT");
    order = paidOrder();
    gw.payments.fetch = async () => gwPayment({ status: "authorized" });
    assert.equal((await requestRefund()).body.code, "PAYMENT_NOT_CAPTURED");
    gw.payments.fetch = async () => gwPayment({ amount_refunded: 200000 });
    assert.equal((await requestRefund({ amountPaise: 100000 })).body.code, "REFUND_EXCEEDS_CAPTURED");
    assert.equal(calls.refund, 0);
});

test("a duplicate refund request with the same key is a replay and never reaches Razorpay twice", async () => {
    order = paidOrder();
    await requestRefund();
    const again = await requestRefund();
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(calls.refund, 1);
    assert.equal(order.refunds.length, 1);
    const reused = await requestRefund({ amountPaise: 1000 });
    assert.equal(reused.body.code, "IDEMPOTENCY_KEY_REUSED");
});

test("a gateway timeout keeps the refund as requested, blocks a second request, and a sync finds it without recreating it", async () => {
    order = paidOrder();
    gw.payments.refund = async () => { calls.refund += 1; throw Object.assign(new Error("timed out"), { code: "GATEWAY_TIMEOUT" }); };
    const res = await requestRefund();
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.code, "REFUND_OUTCOME_UNCERTAIN");
    assert.equal(order.refunds[0].status, "requested");

    const blocked = await requestRefund({ idempotencyKey: key(2), amountPaise: 1000 });
    assert.equal(blocked.body.code, "REFUND_IN_DOUBT");

    // Razorpay did create it; the sync matches it by the id we sent as a note and does not submit again.
    gw.payments.fetchMultipleRefund = async () => ({ items: [gwRefund({ id: "rfnd_late", notes: { pshRefundId: pshId() } })] });
    const synced = await syncNow();
    assert.equal(synced.statusCode, 200);
    assert.equal(order.refunds[0].status, "pending");
    assert.equal(order.refunds[0].refundId, "rfnd_late");
    assert.equal(calls.refund, 1, "recovery must never create a second refund");
});

test("a definitive Razorpay rejection records the refund as failed and releases its amount", async () => {
    order = paidOrder();
    gw.payments.refund = async () => { throw Object.assign(new Error("x"), { statusCode: 400, error: { description: "Refund amount invalid" } }); };
    const res = await requestRefund();
    assert.equal(res.statusCode, 422);
    assert.equal(order.refunds[0].status, "failed");
    assert.equal(serializeAdminOrder(order).refundSummary.remainingPaise, TOTAL);
});

test("an unconfirmed request that Razorpay has no record of is failed only after the stale window", async () => {
    order = paidOrder();
    gw.payments.refund = async () => { throw Object.assign(new Error("timed out"), { code: "GATEWAY_TIMEOUT" }); };
    await requestRefund();
    await syncNow();
    assert.equal(order.refunds[0].status, "requested", "too recent to conclude it was never created");
    order.refunds[0].requestedAt = new Date(Date.now() - 31 * 60 * 1000);
    await syncNow();
    assert.equal(order.refunds[0].status, "failed");
});

// ---------------------------------------------------------------- refund webhooks

const pendingRefund = async (amountPaise = TOTAL, id = key(1)) => {
    await requestRefund({ amountPaise, idempotencyKey: id });
    return order.refunds[order.refunds.length - 1];
};

test("refund.created records a matching request as pending without completing it", async () => {
    order = paidOrder();
    gw.payments.refund = async () => { throw Object.assign(new Error("timed out"), { code: "GATEWAY_TIMEOUT" }); };
    await requestRefund();
    const res = await refundWebhook("refund.created", gwRefund({ id: "rfnd_w1", notes: { pshRefundId: pshId() } }), "evt_1");
    assert.equal(res.statusCode, 200);
    assert.equal(order.refunds[0].status, "pending");
    assert.equal(order.refunds[0].refundId, "rfnd_w1");
    assert.equal(order.refundedPaise, 0);
});

test("refund.processed completes the refund, marks a full refund, and queues one notification", async () => {
    order = paidOrder();
    const record = await pendingRefund();
    const res = await refundWebhook("refund.processed", gwRefund({ id: record.refundId, status: "processed" }), "evt_2");
    assert.equal(res.statusCode, 200);
    assert.equal(order.refunds[0].status, "processed");
    assert.ok(order.refunds[0].processedAt);
    assert.equal(order.refundedPaise, TOTAL);
    assert.equal(order.paymentStatus, "refunded");
    assert.equal(staged.filter(item => item.type === "refund_processed" || String(item.dedupeKey).includes("refund")).length, 1);
});

test("refund.failed marks the refund failed, keeps the order paid, and frees the amount", async () => {
    order = paidOrder();
    const record = await pendingRefund();
    await refundWebhook("refund.failed", gwRefund({ id: record.refundId, status: "failed" }), "evt_3");
    assert.equal(order.refunds[0].status, "failed");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.refundedPaise, 0);
    assert.equal(serializeAdminOrder(order).refundSummary.remainingPaise, TOTAL);
});

test("a duplicate refund event id and a repeated state are both no-ops", async () => {
    order = paidOrder();
    const record = await pendingRefund(100000);
    const event = gwRefund({ id: record.refundId, amount: 100000, status: "processed" });
    await refundWebhook("refund.processed", event, "evt_4");
    const dup = await refundWebhook("refund.processed", event, "evt_4");
    assert.equal(dup.body.result, "duplicate");
    await refundWebhook("refund.processed", event, "evt_4b");
    assert.equal(order.refundedPaise, 100000, "processed twice must not double count");
    assert.equal(order.refunds.length, 1);
});

test("out-of-order events never downgrade a processed refund", async () => {
    order = paidOrder();
    const record = await pendingRefund();
    await refundWebhook("refund.processed", gwRefund({ id: record.refundId, status: "processed" }), "evt_5");
    await refundWebhook("refund.created", gwRefund({ id: record.refundId, status: "pending" }), "evt_6");
    await refundWebhook("refund.failed", gwRefund({ id: record.refundId, status: "failed" }), "evt_7");
    assert.equal(order.refunds[0].status, "processed");
    assert.equal(order.refundedPaise, TOTAL);
    assert.equal(order.paymentStatus, "refunded");
});

test("a processed event after a failed one is accepted because Razorpay is the authority", async () => {
    order = paidOrder();
    const record = await pendingRefund();
    await refundWebhook("refund.failed", gwRefund({ id: record.refundId, status: "failed" }), "evt_8");
    await refundWebhook("refund.processed", gwRefund({ id: record.refundId, status: "processed" }), "evt_9");
    assert.equal(order.refunds[0].status, "processed");
    assert.equal(order.refundedPaise, TOTAL);
});

test("a refund for an unknown payment is not attached to any order and is preserved for investigation", async () => {
    order = paidOrder();
    const res = await refundWebhook("refund.processed", gwRefund({ id: "rfnd_x", payment_id: "pay_UNKNOWN", status: "processed" }), "evt_10",
        { id: "pay_UNKNOWN", order_id: "order_NOBODY" });
    assert.equal(res.statusCode, 200);
    assert.equal(order.refunds.length, 0);
    assert.equal(order.refundedPaise, 0);
    assert.equal(anomalies[0]?.kind, "refund_unknown_order");
    assert.equal(anomalies[0].refundId, "rfnd_x");
});

test("a refund whose payment id is not on the matched order is rejected and preserved", async () => {
    order = paidOrder();
    const res = await refundWebhook("refund.processed", gwRefund({ id: "rfnd_y", payment_id: "pay_OTHER", status: "processed" }), "evt_11",
        { id: "pay_OTHER", order_id: RZP_ORDER });
    assert.equal(res.statusCode, 400);
    assert.equal(order.refunds.length, 0);
    assert.equal(anomalies.at(-1).kind, "refund_mismatch");
});

test("a refund with a different amount or currency than the recorded request is rejected", async () => {
    order = paidOrder();
    const record = await pendingRefund(100000);
    const amount = await refundWebhook("refund.processed", gwRefund({ id: record.refundId, amount: 200000, status: "processed" }), "evt_12");
    assert.equal(amount.statusCode, 400);
    const currency = await refundWebhook("refund.processed", gwRefund({ id: record.refundId, amount: 100000, currency: "USD", status: "processed" }), "evt_13");
    assert.equal(currency.statusCode, 400);
    assert.equal(order.refunds[0].status, "pending");
    assert.equal(order.refundedPaise, 0);
});

test("a partial refund followed by another partial refund accumulates without marking the order refunded", async () => {
    order = paidOrder();
    const first = await pendingRefund(100000, key(1));
    await refundWebhook("refund.processed", gwRefund({ id: first.refundId, amount: 100000, status: "processed" }), "evt_14");
    assert.equal(order.refundedPaise, 100000);
    assert.equal(order.paymentStatus, "paid");
    const second = await pendingRefund(50000, key(2));
    await refundWebhook("refund.processed", gwRefund({ id: second.refundId, amount: 50000, status: "processed" }), "evt_15");
    assert.equal(order.refundedPaise, 150000);
    assert.equal(order.paymentStatus, "paid");
    assert.equal(serializeCustomerOrder(order).refundStatus, "partial");
});

test("the final refund after accumulated partials marks the order refunded only once everything is processed", async () => {
    order = paidOrder();
    const first = await pendingRefund(100000, key(1));
    const rest = await pendingRefund(150000, key(2));
    await refundWebhook("refund.processed", gwRefund({ id: first.refundId, amount: 100000, status: "processed" }), "evt_16");
    assert.equal(order.paymentStatus, "paid", "the second refund is still pending");
    assert.equal(serializeCustomerOrder(order).refundStatus, "pending");
    await refundWebhook("refund.processed", gwRefund({ id: rest.refundId, amount: 150000, status: "processed" }), "evt_17");
    assert.equal(order.refundedPaise, TOTAL);
    assert.equal(order.paymentStatus, "refunded");
});

test("pending or failed refunds alone never mark the order refunded", async () => {
    order = paidOrder();
    const record = await pendingRefund();
    assert.equal(order.paymentStatus, "paid");
    await refundWebhook("refund.failed", gwRefund({ id: record.refundId, status: "failed" }), "evt_18");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.refundedPaise, 0);
});

test("processing a refund never restores stock or clears a fulfilment hold", async () => {
    order = paidOrder({ fulfillmentHold: true, paymentReviewRequired: true, paymentReviewReason: "stock_unavailable" });
    const before = stockSnapshot();
    const record = await pendingRefund();
    await refundWebhook("refund.processed", gwRefund({ id: record.refundId, status: "processed" }), "evt_19");
    assert.deepEqual(variants, before);
    assert.equal(order.fulfillmentHold, true, "a refund does not release a review hold");
    assert.equal(order.paymentReviewRequired, true);
});

test("a refund on a cancelled paid order is allowed and still touches no stock", async () => {
    order = paidOrder({ status: "Cancelled" });
    const before = stockSnapshot();
    const res = await requestRefund();
    assert.equal(res.statusCode, 201);
    assert.deepEqual(variants, before);
});

test("a legacy refund record without a status counts as processed and the old wrapper still works", () => {
    order = paidOrder({ refundedPaise: 100000, refunds: [{ refundId: "rfnd_old", amountPaise: 100000, processedAt: new Date() }] });
    assert.equal(serializeAdminOrder(order).refunds[0].status, "processed");
    assert.equal(serializeAdminOrder(order).refundSummary.remainingPaise, 150000);
    const result = applyProcessedRefund(order, { id: "rfnd_new", payment_id: PAY_A, amount: 150000, currency: "INR", status: "processed" });
    assert.equal(result.fullyRefunded, true);
    assert.equal(order.paymentStatus, "refunded");
});

test("customers see a coarse refund status and never gateway details", async () => {
    order = paidOrder();
    await pendingRefund(100000);
    const customer = serializeCustomerOrder(order);
    assert.equal(customer.refundStatus, "pending");
    assert.equal(JSON.stringify(customer).includes("rfnd_"), false);
    assert.equal(customer.refunds, undefined);
});

// ---------------------------------------------------------------- reconciliation

const gatewayHas = (...items) => { gw.orders.fetchPayments = async () => { calls.fetchPayments += 1; return { items }; }; };

test("a pending order with a captured payment is settled once and stock is deducted once", async () => {
    gatewayHas(gwPayment());
    const result = await reconcilePayments({});
    assert.equal(result.counts.settled, 1);
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.razorpayPaymentId, PAY_A);
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
    assert.equal(order.reconciliation.lastOutcome, "settled");
});

test("an expired order with a captured payment re-acquires stock atomically and settles", async () => {
    order = makeOrder({ paymentStatus: "expired", reservationHeld: false });
    variants.v1 = { stockOnHand: 5, reserved: 0, active: true };
    gatewayHas(gwPayment());
    const result = await reconcilePayments({});
    assert.equal(result.counts.settled, 1);
    assert.equal(order.paymentStatus, "paid");
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
});

test("an authorized order that was later captured is settled", async () => {
    order = makeOrder({ paymentStatus: "authorized" });
    gatewayHas(gwPayment());
    assert.equal((await reconcilePayments({})).counts.settled, 1);
    assert.equal(order.paymentStatus, "paid");
});

test("an already-settled payment is reported and nothing changes", async () => {
    order = paidOrder();
    const before = stockSnapshot();
    gatewayHas(gwPayment());
    const result = await reconcilePayments({ orderId: ORDER_ID });
    assert.equal(result.counts.already_settled, 1);
    assert.deepEqual(variants, before);
});

test("repeated reconciliation runs never deduct stock twice", async () => {
    gatewayHas(gwPayment());
    const later = new Date(Date.now() + 10 * 60 * 1000);
    await reconcilePayments({});
    const afterFirst = stockSnapshot();
    const second = await reconcilePayments({ now: later });
    assert.equal(second.examined, 0, "a settled order is no longer a candidate");
    const targeted = await reconcilePayments({ orderId: ORDER_ID, now: later });
    assert.equal(targeted.counts.already_settled, 1);
    assert.deepEqual(variants, afterFirst);
});

test("a captured payment with the wrong amount is never settled, is flagged, and is preserved", async () => {
    gatewayHas(gwPayment({ amount: 100 }));
    const before = stockSnapshot();
    const result = await reconcilePayments({});
    assert.equal(result.counts.mismatch, 1);
    assert.equal(order.paymentStatus, "pending");
    assert.equal(order.paymentReviewReason, "payment_mismatch");
    assert.equal(order.fulfillmentHold, false);
    assert.deepEqual(variants, before);
    assert.equal(anomalies[0].kind, "captured_payment_mismatch");
});

test("a captured payment in the wrong currency is never settled", async () => {
    gatewayHas(gwPayment({ currency: "USD" }));
    assert.equal((await reconcilePayments({})).counts.mismatch, 1);
    assert.equal(order.paymentStatus, "pending");
});

test("a captured payment bound to a different Razorpay order is never settled", async () => {
    gatewayHas(gwPayment({ order_id: "order_OTHER" }));
    assert.equal((await reconcilePayments({})).counts.mismatch, 1);
    assert.equal(order.paymentStatus, "pending");
});

test("a gateway timeout is recorded and the order is left untouched", async () => {
    gw.orders.fetchPayments = async () => { throw Object.assign(new Error("timeout"), { code: "GATEWAY_TIMEOUT" }); };
    const result = await reconcilePayments({});
    assert.equal(result.counts.timeout, 1);
    assert.equal(order.paymentStatus, "pending");
    assert.equal(order.reconciliation.lastOutcome, "timeout");
    assert.equal(lockHeld, false, "the lease is always released");
});

test("a rate limit aborts the run instead of hammering Razorpay", async () => {
    gw.orders.fetchPayments = async () => { throw Object.assign(new Error("slow down"), { statusCode: 429 }); };
    const result = await reconcilePayments({});
    assert.equal(result.status, "aborted");
    assert.equal(result.abortReason, "rate_limited");
    assert.equal(order.paymentStatus, "pending");
});

test("incomplete gateway evidence never marks an order paid", async () => {
    gw.orders.fetchPayments = async () => ({});
    assert.equal((await reconcilePayments({})).counts.incomplete_evidence, 1);
    assert.equal(order.paymentStatus, "pending");
});

test("an order with no captured payment at Razorpay stays unpaid", async () => {
    gatewayHas(gwPayment({ status: "failed" }));
    assert.equal((await reconcilePayments({})).counts.no_capture, 1);
    assert.equal(order.paymentStatus, "pending");
});

test("concurrent reconciliation runs cannot both start", async () => {
    gatewayHas(gwPayment());
    const [first, second] = await Promise.all([reconcilePayments({}), reconcilePayments({})]);
    assert.equal([first, second].filter(r => r.started).length, 1);
    assert.equal([first, second].find(r => !r.started).code, "RECONCILIATION_RUNNING");
    assert.deepEqual(variants.v1, { stockOnHand: 3, reserved: 0, active: true });
});

test("a captured payment with unavailable stock is settled onto an explicit review hold, not fulfilled", async () => {
    order = makeOrder({ paymentStatus: "expired", reservationHeld: false });
    variants.v1 = { stockOnHand: 1, reserved: 0, active: true };
    gatewayHas(gwPayment());
    const result = await reconcilePayments({});
    assert.equal(result.counts.settled_on_hold, 1);
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.fulfillmentHold, true);
    assert.equal(order.paymentReviewReason, "stock_unavailable");
    assert.deepEqual(variants.v1, { stockOnHand: 1, reserved: 0, active: true });
});

test("a captured payment on a cancelled order is held for review and never fulfilled or restocked", async () => {
    order = makeOrder({ status: "Cancelled", reservationHeld: false });
    const before = stockSnapshot();
    gatewayHas(gwPayment());
    const result = await reconcilePayments({});
    assert.equal(result.counts.settled_on_hold, 1);
    assert.equal(order.fulfillmentHold, true);
    assert.equal(order.paymentReviewReason, "order_cancelled");
    assert.equal(order.status, "Cancelled");
    assert.deepEqual(variants, before);
});

test("a paid order on review hold is reported and never cleared, and Razorpay is not even queried", async () => {
    order = paidOrder({ fulfillmentHold: true, paymentReviewRequired: true, paymentReviewReason: "stock_unavailable" });
    const result = await reconcilePayments({});
    assert.equal(result.counts.needs_review, 1);
    assert.equal(order.fulfillmentHold, true);
    assert.equal(calls.fetchPayments, 0);
});

test("a second distinct captured payment on a settled order is recorded for review and stock is not deducted again", async () => {
    order = paidOrder();
    const before = stockSnapshot();
    gatewayHas(gwPayment(), gwPayment({ id: PAY_B, created_at: 2 }));
    const result = await reconcilePayments({ orderId: ORDER_ID });
    assert.equal(result.counts.duplicate_recorded, 1);
    assert.deepEqual([...order.duplicatePaymentIds], [PAY_B]);
    assert.equal(order.paymentReviewRequired, true);
    assert.deepEqual(variants, before);
});

test("reconciliation limits are clamped to safe bounds", async () => {
    gatewayHas();
    await reconcilePayments({ limit: 100000, windowHours: 100000 });
    assert.equal(runs[0].limit, 100);
    assert.equal(runs[0].windowHours, 168);
});

// ---------------------------------------------------------------- reconciliation access control

test("the scheduled endpoint is disabled until a long token is configured and rejects wrong tokens", async () => {
    const call = async token => {
        const res = jsonResponse();
        await reconcileScheduled({ headers: token === undefined ? {} : { "x-reconcile-token": token }, body: {} }, res);
        return res;
    };
    assert.equal((await call("anything")).statusCode, 503);
    process.env.RECONCILIATION_JOB_TOKEN = "short";
    assert.equal((await call("short")).statusCode, 503, "short tokens are refused outright");
    process.env.RECONCILIATION_JOB_TOKEN = "t".repeat(40);
    assert.equal((await call(undefined)).statusCode, 401);
    assert.equal((await call("wrong")).statusCode, 401);
    gatewayHas();
    assert.equal((await call("t".repeat(40))).statusCode, 200);
});

test("the admin reconcile handler validates the targeted order id", async () => {
    const res = jsonResponse();
    await reconcileNow({ body: { orderId: { $ne: "" } } }, res);
    assert.equal(res.statusCode, 400);
});
