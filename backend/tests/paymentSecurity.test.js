import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
    isValidIdempotencyKey,
    validateCapturedPayment,
    validateWebhookPayment,
    verifyCheckoutSignature,
    verifyWebhookSignature
} from "../utils/paymentSecurity.js";
import { getRazorpayTestConfig, isRazorpayTestConfigured } from "../utils/razorpayConfig.js";

const sign = (message, secret) => createHmac("sha256", secret).update(message).digest("hex");

test("validates checkout callback signatures using the expected Razorpay order and payment IDs", () => {
    const secret = "test-secret";
    const signature = sign("order_test|pay_test", secret);
    assert.equal(verifyCheckoutSignature("order_test", "pay_test", signature, secret), true);
    assert.equal(verifyCheckoutSignature("order_other", "pay_test", signature, secret), false);
    assert.equal(verifyCheckoutSignature("order_test", "pay_test", "invalid", secret), false);
});

test("validates webhook signatures against the original raw request body", () => {
    const secret = "webhook-secret";
    const raw = Buffer.from('{"event":"payment.captured"}');
    const signature = sign(raw, secret);
    assert.equal(verifyWebhookSignature(raw, signature, secret), true);
    assert.equal(verifyWebhookSignature(Buffer.from('{"event":"payment.failed"}'), signature, secret), false);
    assert.equal(verifyWebhookSignature(JSON.parse(raw.toString()), signature, secret), false);
});

test("accepts only captured INR payments matching the stored order ID and amount", () => {
    const payment = { order_id: "order_test", amount: 12500, currency: "INR", status: "captured" };
    const order = { orderId: "order_test", amountPaise: 12500 };
    assert.equal(validateCapturedPayment(payment, order), true);
    assert.equal(validateCapturedPayment({ ...payment, amount: 12501 }, order), false);
    assert.equal(validateCapturedPayment({ ...payment, amount: 12500.5 }, order), false);
    assert.equal(validateCapturedPayment({ ...payment, currency: "USD" }, order), false);
    assert.equal(validateCapturedPayment({ ...payment, status: "authorized" }, order), false);
});

test("validates authorization and failure webhooks against the matching order and event state", () => {
    const order = { razorpayOrderId: "order_test", totalPaise: 12500 };
    const authorized = {
        id: "pay_test",
        order_id: "order_test",
        amount: 12500,
        currency: "INR",
        status: "authorized"
    };
    const failed = { ...authorized, status: "failed" };
    assert.equal(validateWebhookPayment(authorized, order, "payment.authorized"), true);
    assert.equal(validateWebhookPayment(failed, order, "payment.failed"), true);
    assert.equal(validateWebhookPayment(failed, order, "payment.authorized"), false);
    assert.equal(validateWebhookPayment({ ...failed, amount: 12501 }, order, "payment.failed"), false);
    assert.equal(validateWebhookPayment({ ...failed, order_id: "another_order" }, order, "payment.failed"), false);
    assert.equal(validateWebhookPayment({ ...failed, currency: "USD" }, order, "payment.failed"), false);
});

test("requires a UUID idempotency key and complete test-only payment configuration", () => {
    assert.equal(isValidIdempotencyKey("550e8400-e29b-41d4-a716-446655440000"), true);
    assert.equal(isValidIdempotencyKey("not-a-key"), false);
    assert.equal(isRazorpayTestConfigured({
        RAZORPAY_MODE: "test",
        RAZORPAY_KEY_ID: "rzp_test_public",
        RAZORPAY_KEY_SECRET: "server-secret",
        RAZORPAY_WEBHOOK_SECRET: "webhook-secret"
    }), true);
    assert.equal(isRazorpayTestConfigured({
        RAZORPAY_MODE: "live",
        RAZORPAY_KEY_ID: "rzp_live_public",
        RAZORPAY_KEY_SECRET: "server-secret",
        RAZORPAY_WEBHOOK_SECRET: "webhook-secret"
    }), false);
    assert.equal(getRazorpayTestConfig({ RAZORPAY_MODE: "test" }), null);
});
