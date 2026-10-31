import { createHmac, timingSafeEqual } from "node:crypto";

const matchesHexSignature = (expected, supplied) => {
    if (typeof supplied !== "string" || !/^[a-f\d]{64}$/i.test(supplied)) return false;
    const expectedBuffer = Buffer.from(expected, "hex");
    const suppliedBuffer = Buffer.from(supplied, "hex");
    return expectedBuffer.length === suppliedBuffer.length &&
        timingSafeEqual(expectedBuffer, suppliedBuffer);
};

export const verifyCheckoutSignature = (orderId, paymentId, signature, secret) => {
    if (![orderId, paymentId, secret].every(value => typeof value === "string" && value.length > 0)) {
        return false;
    }
    const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    return matchesHexSignature(expected, signature);
};

export const verifyWebhookSignature = (rawBody, signature, secret) => {
    if (!Buffer.isBuffer(rawBody) || typeof secret !== "string" || !secret.length) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return matchesHexSignature(expected, signature);
};

export const validateCapturedPayment = (payment, { orderId, amountPaise }) =>
    payment &&
    payment.order_id === orderId &&
    Number.isSafeInteger(payment.amount) &&
    payment.amount === amountPaise &&
    payment.currency === "INR" &&
    payment.status === "captured";

export const validateWebhookPayment = (payment, order, event) =>
    payment &&
    typeof payment.id === "string" &&
    payment.id.length > 0 &&
    paymentMatchesOrder(payment, order) &&
    ((event === "payment.authorized" && payment.status === "authorized") ||
        (event === "payment.failed" && payment.status === "failed"));

const paymentMatchesOrder = (payment, order) =>
    typeof payment.order_id === "string" &&
    payment.order_id === order.razorpayOrderId &&
    Number.isSafeInteger(payment.amount) &&
    payment.amount === order.totalPaise &&
    payment.currency === "INR";

export const isValidIdempotencyKey = value =>
    typeof value === "string" &&
    /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
