import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { afterEach, beforeEach, mock } from "node:test";
import mongoose from "mongoose";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import productVariantModel from "../models/productVariantModel.js";
import razorpayWebhookEventModel from "../models/razorpayWebhookEventModel.js";
import paymentAnomalyModel from "../models/paymentAnomalyModel.js";
import notificationEventModel from "../models/notificationEventModel.js";
import { notifications } from "../utils/notifications/index.js";
import {
    razorpayGateway,
    razorpayWebhook,
    verifyRazorpayPayment
} from "../controllers/razorpayController.js";

// Fake credentials only. No real Razorpay endpoint or database is ever contacted.
const KEY_SECRET = "test_key_secret_value";
const WEBHOOK_SECRET = "test_webhook_secret_value";
const ENV_KEYS = ["RAZORPAY_MODE", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
const ORDER_ID = "665f1c2e8f1b2c0012345678";
const USER_ID = "665f1c2e8f1b2c0087654321";
const RZP_ORDER = "order_TEST0001";
const RZP_PAYMENT = "pay_TEST0001";

let savedEnv;
let order;
let staged;
let webhookEventIds;
let variantUpdates;

const query = value => ({
    session() { return this; },
    select() { return this; },
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
        razorpayPaymentId: "",
        reservationHeld: true,
        fulfillmentHold: false,
        paymentReviewRequired: false,
        refundedPaise: 0,
        refunds: [],
        duplicatePaymentIds: Object.assign([], { addToSet(id) { if (!this.includes(id)) this.push(id); } }),
        statusHistory: [],
        whatsappOptIn: false,
        address: { firstName: "Asha", email: "asha@example.com", phone: "9876543210" },
        items: [{ variantId: "v1", quantity: 1 }],
        ...overrides
    };
    data.save = async () => data;
    return data;
};

const matchesFilter = (doc, filter) => Object.entries(filter).every(([key, value]) =>
    key === "$or" ? value.some(part => matchesFilter(doc, part)) : String(doc[key]) === String(value));

const snapshot = doc => Object.fromEntries(Object.entries(doc)
    .filter(([, value]) => typeof value !== "function")
    .map(([key, value]) => [key, Array.isArray(value) ? structuredClone([...value]) : structuredClone(value)]));
const restore = (doc, saved) => {
    for (const [key, value] of Object.entries(saved)) {
        if (Array.isArray(doc[key])) doc[key].splice(0, doc[key].length, ...value);
        else doc[key] = value;
    }
};

const jsonResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const capturedPayment = (overrides = {}) => ({
    id: RZP_PAYMENT, order_id: RZP_ORDER, amount: 250000, currency: "INR", status: "captured", ...overrides
});

const signedWebhook = (payload, eventId, { secret = WEBHOOK_SECRET } = {}) => {
    const body = Buffer.from(JSON.stringify(payload));
    const headers = {
        "x-razorpay-signature": createHmac("sha256", secret).update(body).digest("hex"),
        "x-razorpay-event-id": eventId
    };
    return { body, get: name => headers[name.toLowerCase()] };
};

const sendWebhook = async (payload, eventId, options) => {
    const res = jsonResponse();
    await razorpayWebhook(signedWebhook(payload, eventId, options), res);
    return res;
};

const paymentEvent = (event, payment = capturedPayment()) => ({ event, payload: { payment: { entity: payment } } });
const orderPaidEvent = (amount = 250000) => ({
    event: "order.paid",
    payload: { order: { entity: { id: RZP_ORDER, amount_paid: amount, currency: "INR", status: "paid" } } }
});
const refundEvent = (refund, payment = { order_id: RZP_ORDER }) => ({
    event: "refund.processed",
    payload: {
        refund: { entity: { payment_id: RZP_PAYMENT, currency: "INR", status: "processed", ...refund } },
        payment: { entity: payment }
    }
});

const verifyRequest = (overrides = {}) => {
    const body = {
        orderId: ORDER_ID,
        razorpay_order_id: RZP_ORDER,
        razorpay_payment_id: RZP_PAYMENT,
        razorpay_signature: createHmac("sha256", KEY_SECRET).update(`${RZP_ORDER}|${RZP_PAYMENT}`).digest("hex"),
        ...overrides
    };
    return { body, auth: { userId: USER_ID } };
};

const stubGateway = payment => mock.method(razorpayGateway, "client", () => ({
    payments: { fetch: async () => payment }
}));

const stagedTypes = () => staged.map(item => item.dedupeKey.split(":").slice(1).join(":"));

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    Object.assign(process.env, {
        RAZORPAY_MODE: "test",
        RAZORPAY_KEY_ID: "rzp_test_fakekeyid",
        RAZORPAY_KEY_SECRET: KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET
    });
    order = makeOrder();
    staged = [];
    webhookEventIds = new Set();
    variantUpdates = 0;

    mock.method(mongoose, "startSession", async () => ({
        async withTransaction(fn) {
            const saved = snapshot(order);
            try { return await fn(); } catch (error) { restore(order, saved); throw error; }
        },
        async endSession() {}
    }));
    mock.method(orderModel, "findOne", filter => query(matchesFilter(order, filter) ? order : null));
    mock.method(orderModel, "findById", id => query(String(id) === ORDER_ID ? order : null));
    mock.method(razorpayWebhookEventModel, "create", async ([doc]) => {
        if (webhookEventIds.has(doc.eventId)) throw Object.assign(new Error("E11000"), { code: 11000 });
        webhookEventIds.add(doc.eventId);
    });
    mock.method(userModel, "updateOne", async () => ({ modifiedCount: 1 }));
    mock.method(paymentAnomalyModel, "updateOne", async () => ({ upsertedCount: 1 }));
    mock.method(productVariantModel, "exists", () => query(true));
    mock.method(productVariantModel, "updateOne", async () => { variantUpdates += 1; return { modifiedCount: 1 }; });
    mock.method(notificationEventModel, "updateOne", async (filter, update) => {
        if (staged.some(item => item.dedupeKey === filter.dedupeKey)) return { upsertedCount: 0 };
        staged.push(update.$setOnInsert);
        return { upsertedCount: 1 };
    });
    mock.method(notificationEventModel, "find", () => ({ sort() { return this; }, limit() { return this; }, lean: async () => [] }));
    mock.method(console, "error", () => {});
});

afterEach(() => {
    mock.restoreAll();
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
});

test("a late capture on a cancelled order stays cancelled and on fulfilment hold and cannot be fulfilled", async () => {
    order = makeOrder({ status: "Cancelled", reservationHeld: false });
    const res = await sendWebhook(paymentEvent("payment.captured"), "evt_late");
    assert.equal(res.body.result, "processed");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.fulfillmentHold, true);
    assert.equal(order.status, "Cancelled");
    assert.deepEqual(stagedTypes(), ["payment_success"]);
    assert.equal(staged.some(item => /dispatched|delivery|delivered/.test(item.dedupeKey)), false);
    const { allowedNextStatuses } = await import("../utils/orderFulfillment.js");
    assert.deepEqual(allowedNextStatuses(order), ["Cancelled"]);
});

test("a refund in the wrong currency is rejected", async () => {
    paidOrder();
    const res = await sendWebhook(refundEvent({ id: "rfnd_usd", amount: 1000, currency: "USD" }), "evt_usd");
    assert.equal(res.statusCode, 400);
    assert.equal(order.refundedPaise, 0);
});

test("captured payments with the wrong currency or order id never settle the order", async () => {
    const wrongCurrency = await sendWebhook(paymentEvent("payment.captured", capturedPayment({ currency: "USD" })), "evt_cur");
    assert.equal(wrongCurrency.statusCode, 400);
    const unknownOrder = await sendWebhook(paymentEvent("payment.captured", capturedPayment({ order_id: "order_OTHER" })), "evt_oth");
    assert.equal(unknownOrder.body.result, "processed");
    assert.equal(order.paymentStatus, "pending");
    assert.equal(staged.length, 0);
});

test("verification rejects a malformed order id and a mismatched Razorpay order id", async () => {
    stubGateway(capturedPayment());
    const malformed = jsonResponse();
    await verifyRazorpayPayment(verifyRequest({ orderId: "not-an-id" }), malformed);
    assert.equal(malformed.statusCode, 400);
    const mismatched = jsonResponse();
    await verifyRazorpayPayment(verifyRequest({ razorpay_order_id: "order_OTHER" }), mismatched);
    assert.equal(mismatched.statusCode, 400);
    assert.equal(order.paymentStatus, "pending");
});

test("payment.captured settles the order once and a duplicate delivery changes nothing", async () => {
    const first = await sendWebhook(paymentEvent("payment.captured"), "evt_1");
    assert.deepEqual(first.body, { success: true, result: "processed" });
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.razorpayPaymentId, RZP_PAYMENT);
    assert.equal(order.fulfillmentHold, false);
    assert.deepEqual(stagedTypes(), ["payment_success"]);
    const historyLength = order.statusHistory.length;
    const stockWrites = variantUpdates;

    const duplicate = await sendWebhook(paymentEvent("payment.captured"), "evt_1");
    assert.deepEqual(duplicate.body, { success: true, result: "duplicate" });
    assert.equal(order.statusHistory.length, historyLength);
    assert.equal(variantUpdates, stockWrites);
    assert.equal(staged.length, 1);
});

test("order.paid after payment.captured (a different event id) is idempotent and adds no second notification", async () => {
    await sendWebhook(paymentEvent("payment.captured"), "evt_1");
    const history = order.statusHistory.length;
    const res = await sendWebhook(orderPaidEvent(), "evt_2");
    assert.equal(res.body.result, "processed");
    assert.equal(order.statusHistory.length, history);
    assert.equal(staged.length, 1, "the unique dedupe key prevents a second payment_success event");
});

test("a duplicate order.paid delivery is acknowledged without reprocessing", async () => {
    assert.equal((await sendWebhook(orderPaidEvent(), "evt_9")).body.result, "processed");
    assert.equal(order.paymentStatus, "paid");
    assert.equal((await sendWebhook(orderPaidEvent(), "evt_9")).body.result, "duplicate");
    assert.equal(staged.length, 1);
});

test("a captured payment with the wrong amount is rejected and the order stays unpaid", async () => {
    const res = await sendWebhook(paymentEvent("payment.captured", capturedPayment({ amount: 100 })), "evt_bad");
    assert.equal(res.statusCode, 400);
    assert.equal(order.paymentStatus, "pending");
    assert.equal(staged.length, 0);
});

test("invalid signatures and missing event ids are rejected before any processing", async () => {
    const bad = await sendWebhook(paymentEvent("payment.captured"), "evt_sig", { secret: "wrong_secret" });
    assert.equal(bad.statusCode, 400);
    const noId = jsonResponse();
    const request = signedWebhook(paymentEvent("payment.captured"), "evt_x");
    await razorpayWebhook({ body: request.body, get: name => (name.toLowerCase() === "x-razorpay-event-id" ? "" : request.get(name)) }, noId);
    assert.equal(noId.statusCode, 400);
    assert.equal(order.paymentStatus, "pending");
});

const paidOrder = overrides => {
    order = makeOrder({ paymentStatus: "paid", payment: true, reservationHeld: false, razorpayPaymentId: RZP_PAYMENT, ...overrides });
};

test("a partial refund is recorded, keeps the order paid, and notifies once per refund id", async () => {
    paidOrder();
    const res = await sendWebhook(refundEvent({ id: "rfnd_1", amount: 50000 }), "evt_r1");
    assert.equal(res.body.result, "processed");
    assert.equal(order.refundedPaise, 50000);
    assert.equal(order.paymentStatus, "paid");
    assert.deepEqual(stagedTypes(), ["refund_processed:rfnd_1"]);
});

test("multiple partial refunds accumulate and the last one that reaches the total marks it refunded", async () => {
    paidOrder();
    await sendWebhook(refundEvent({ id: "rfnd_1", amount: 100000 }), "evt_r1");
    await sendWebhook(refundEvent({ id: "rfnd_2", amount: 100000 }), "evt_r2");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.refundedPaise, 200000);
    await sendWebhook(refundEvent({ id: "rfnd_3", amount: 50000 }), "evt_r3");
    assert.equal(order.refundedPaise, 250000);
    assert.equal(order.paymentStatus, "refunded");
    assert.equal(order.refunds.length, 3);
    assert.deepEqual(stagedTypes(), ["refund_processed:rfnd_1", "refund_processed:rfnd_2", "refund_processed:rfnd_3"]);
    const paymentEntries = order.statusHistory.filter(entry => entry.kind === "payment");
    assert.deepEqual(paymentEntries.map(entry => [entry.from, entry.to, entry.actor]), [["paid", "refunded", "system"]]);
});

test("a full refund marks the order refunded", async () => {
    paidOrder();
    await sendWebhook(refundEvent({ id: "rfnd_full", amount: 250000 }), "evt_full");
    assert.equal(order.paymentStatus, "refunded");
    assert.equal(order.refundedPaise, 250000);
});

test("a duplicate refund.processed (same event id or same refund id) is not applied or notified twice", async () => {
    paidOrder();
    await sendWebhook(refundEvent({ id: "rfnd_1", amount: 50000 }), "evt_r1");
    assert.equal((await sendWebhook(refundEvent({ id: "rfnd_1", amount: 50000 }), "evt_r1")).body.result, "duplicate");
    assert.equal((await sendWebhook(refundEvent({ id: "rfnd_1", amount: 50000 }), "evt_r1_again")).body.result, "processed");
    assert.equal(order.refundedPaise, 50000);
    assert.equal(order.refunds.length, 1);
    assert.equal(staged.length, 1);
});

test("invalid refund amounts and over-refunds are rejected without changing the order", async () => {
    paidOrder();
    for (const [index, amount] of [0, -5, 1.5, "100", 250001].entries()) {
        const res = await sendWebhook(refundEvent({ id: `rfnd_bad${index}`, amount }), `evt_bad${index}`);
        assert.equal(res.statusCode, 400, `amount ${amount}`);
    }
    assert.equal(order.refundedPaise, 0);
    assert.equal(order.refunds.length, 0);
    assert.equal(order.paymentStatus, "paid");
    assert.equal(staged.length, 0);
});

test("a refund that belongs to a different payment is rejected", async () => {
    paidOrder();
    const res = await sendWebhook(
        { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_x", payment_id: RZP_PAYMENT, amount: 1000, currency: "INR", status: "processed" } }, payment: { entity: { order_id: RZP_ORDER } } } },
        "evt_ok"
    );
    assert.equal(res.statusCode, 200);

    paidOrder({ razorpayPaymentId: "pay_OTHER" });
    const wrong = await sendWebhook(
        { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_y", payment_id: RZP_PAYMENT, amount: 1000, currency: "INR", status: "processed" } }, payment: { entity: { order_id: RZP_ORDER } } } },
        "evt_wrong"
    );
    assert.equal(wrong.statusCode, 400);
    assert.equal(order.refundedPaise, 0);
});

test("a refund for an unknown order or an unpaid order is not applied", async () => {
    const unknown = await sendWebhook(refundEvent({ id: "rfnd_1", amount: 1000 }, { order_id: "order_UNKNOWN" }), "evt_u");
    assert.equal(unknown.body.result, "processed");
    assert.equal(order.refundedPaise, 0);

    // The payment id matches, but the order was never paid, so there is nothing to refund.
    order = makeOrder({ razorpayPaymentId: RZP_PAYMENT, paymentStatus: "pending" });
    const unpaid = await sendWebhook(refundEvent({ id: "rfnd_2", amount: 1000 }), "evt_p");
    assert.equal(unpaid.statusCode, 400);
    assert.equal(order.refundedPaise, 0);
});

test("a refund that is not yet processed is ignored", async () => {
    paidOrder();
    const res = await sendWebhook(refundEvent({ id: "rfnd_1", amount: 1000, status: "pending" }), "evt_pending");
    assert.equal(res.statusCode, 200);
    assert.equal(order.refundedPaise, 0);
    assert.equal(staged.length, 0);
});

test("payment.failed records the failure but keeps the reservation and never confirms the order", async () => {
    const res = await sendWebhook(paymentEvent("payment.failed", capturedPayment({ status: "failed" })), "evt_fail");
    assert.equal(res.body.result, "processed");
    assert.equal(order.paymentStatus, "failed");
    assert.equal(order.reservationHeld, true, "the customer may still pay in the same Razorpay modal");
    assert.equal(variantUpdates, 0, "a failed attempt performs no stock write");
    assert.equal(staged.length, 0, "no success notification for a failed payment");
});

test("payment.failed never downgrades an order that is already paid", async () => {
    await sendWebhook(paymentEvent("payment.captured"), "evt_1");
    await sendWebhook(paymentEvent("payment.failed", capturedPayment({ status: "failed" })), "evt_2");
    assert.equal(order.paymentStatus, "paid");
});

test("verification confirms a captured payment and a repeated verification is idempotent", async () => {
    stubGateway(capturedPayment());
    const first = jsonResponse();
    await verifyRazorpayPayment(verifyRequest(), first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.paymentStatus, "paid");
    const history = order.statusHistory.length;

    const second = jsonResponse();
    await verifyRazorpayPayment(verifyRequest(), second);
    assert.equal(second.statusCode, 200);
    assert.equal(order.statusHistory.length, history);
    assert.equal(staged.length, 1, "payment_success is staged exactly once");
});

test("verification rejects a bad signature without contacting the gateway", async () => {
    const fetch = mock.fn(async () => capturedPayment());
    mock.method(razorpayGateway, "client", () => ({ payments: { fetch } }));
    const res = jsonResponse();
    await verifyRazorpayPayment(verifyRequest({ razorpay_signature: "0".repeat(64) }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(order.paymentStatus, "pending");
});

test("verification rejects a payment whose amount does not match the order", async () => {
    stubGateway(capturedPayment({ amount: 1 }));
    const res = jsonResponse();
    await verifyRazorpayPayment(verifyRequest(), res);
    assert.equal(res.statusCode, 409);
    assert.equal(order.paymentStatus, "pending");
    assert.equal(staged.length, 0);
});

test("a customer cannot verify, and so cannot settle, another customer's order", async () => {
    stubGateway(capturedPayment());
    const res = jsonResponse();
    await verifyRazorpayPayment({ ...verifyRequest(), auth: { userId: "665f1c2e8f1b2c00aaaaaaaa" } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(order.paymentStatus, "pending");
});

test("verification of a failed payment responds 402 and does not confirm the order", async () => {
    stubGateway(capturedPayment({ status: "failed" }));
    const res = jsonResponse();
    await verifyRazorpayPayment(verifyRequest(), res);
    assert.equal(res.statusCode, 402);
    assert.notEqual(order.paymentStatus, "paid");
    assert.equal(staged.length, 0);
});

test("a gateway outage during verification returns 503 and does not alter the order", async () => {
    mock.method(razorpayGateway, "client", () => ({ payments: { fetch: async () => { throw new Error("network down"); } } }));
    const res = jsonResponse();
    await verifyRazorpayPayment(verifyRequest(), res);
    assert.equal(res.statusCode, 503);
    assert.equal(order.paymentStatus, "pending");
});

test("a notification dispatch failure after a successful payment never affects the payment", async () => {
    mock.method(notifications, "dispatchDue", async () => { throw new Error("smtp exploded"); });
    stubGateway(capturedPayment());
    const res = jsonResponse();
    await verifyRazorpayPayment(verifyRequest(), res);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(res.statusCode, 200);
    assert.equal(order.paymentStatus, "paid");
    assert.equal(staged.length, 1, "the outbox event is durable and will be retried by the worker");
});

test("if the outbox write itself fails the payment transaction aborts and Razorpay is asked to retry", async () => {
    mock.method(notificationEventModel, "updateOne", async () => { throw new Error("mongo write failed"); });
    const res = await sendWebhook(paymentEvent("payment.captured"), "evt_outbox");
    assert.equal(res.statusCode, 500);
    assert.equal(order.paymentStatus, "pending", "the order change rolled back with the failed outbox write");
    assert.equal(order.razorpayPaymentId, "");
});
