import mongoose from "mongoose";
import orderModel from "../models/orderModel.js";
import { dispatchNotifications } from "../utils/notifications/index.js";
import { getRazorpayTestConfig } from "../utils/razorpayConfig.js";
import { classifyGatewayError, razorpayGateway, safeGatewayMessage, withTimeout } from "../utils/razorpayGateway.js";
import { isValidIdempotencyKey } from "../utils/paymentSecurity.js";
import { syncOrderRefunds } from "../utils/refundSync.js";
import {
    addRequestedRefund,
    adminRefundView,
    attachGatewayRefund,
    failRequestedRefund,
    registerCapturedPayment,
    validateRefundRequest
} from "../utils/refunds.js";

const apiError = (status, code, message) => Object.assign(new Error(message), { status, code });
const OBJECT_ID = /^[a-f\d]{24}$/i;

const respondError = (res, error) => {
    if (error.status && error.code) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    console.error("Refund request failed:", error.message);
    return res.status(500).json({ success: false, message: "Refund request failed." });
};

const refundResponse = (order, extra = {}) => ({ success: true, ...adminRefundView(order), ...extra });

// Confirms with Razorpay itself (never the client) that the payment is captured for this exact order and
// that the gateway-side refund balance can cover the request.
const verifyCapturedAtGateway = async (client, order, paymentId, amountPaise) => {
    let payment;
    try {
        payment = await withTimeout(client.payments.fetch(paymentId));
    } catch (error) {
        throw apiError(502, "GATEWAY_UNAVAILABLE", "Could not confirm the payment with Razorpay. Nothing was refunded; try again.");
    }
    const isPrimary = paymentId === order.razorpayPaymentId;
    const valid = payment && payment.id === paymentId && payment.status === "captured" && payment.currency === "INR" &&
        Number.isSafeInteger(payment.amount) && payment.amount > 0 &&
        (isPrimary ? payment.amount === order.totalPaise && payment.order_id === order.razorpayOrderId
            : Boolean(order.razorpayOrderId) && payment.order_id === order.razorpayOrderId);
    if (!valid) {
        throw apiError(409, "PAYMENT_NOT_CAPTURED", "Razorpay does not show this payment as captured for this order.");
    }
    const alreadyRefunded = Number.isSafeInteger(payment.amount_refunded) ? payment.amount_refunded : 0;
    if (alreadyRefunded + amountPaise > payment.amount) {
        throw apiError(409, "REFUND_EXCEEDS_CAPTURED", "Razorpay reports that this refund would exceed the captured amount.");
    }
    return { id: payment.id, order_id: payment.order_id, amount: payment.amount, currency: payment.currency };
};

export const initiateRefund = async (req, res) => {
    try {
        const { orderId, amountPaise, reason, idempotencyKey, paymentId } = req.body || {};
        if (typeof orderId !== "string" || !OBJECT_ID.test(orderId)) {
            return res.status(400).json({ success: false, code: "INVALID_ORDER", message: "A valid order is required." });
        }
        if (!isValidIdempotencyKey(idempotencyKey)) {
            return res.status(400).json({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED", message: "A valid refund request key is required." });
        }
        if (!getRazorpayTestConfig()) {
            return res.status(503).json({ success: false, code: "PAYMENTS_NOT_CONFIGURED", message: "Razorpay is not configured." });
        }
        if (paymentId !== undefined && typeof paymentId !== "string") {
            return res.status(400).json({ success: false, code: "PAYMENT_NOT_ON_ORDER", message: "Invalid payment." });
        }

        const preview = await orderModel.findById(orderId);
        if (!preview) return res.status(404).json({ success: false, code: "ORDER_NOT_FOUND", message: "Order not found." });
        const replay = (preview.refunds || []).find(record => record.idempotencyKey === idempotencyKey);
        let verifiedPayment;
        if (!replay) {
            // Cheap structural checks first; secondary payments are re-validated once Razorpay has confirmed them.
            const target = paymentId || preview.razorpayPaymentId;
            const early = validateRefundRequest(preview, { amountPaise, reason, paymentId, verifiedPayment: undefined });
            if (early && early.code !== "PAYMENT_NOT_VERIFIED") throw apiError(early.status, early.code, early.message);
            verifiedPayment = await verifyCapturedAtGateway(razorpayGateway.client(), preview, target, amountPaise);
            const problem = validateRefundRequest(preview, { amountPaise, reason, paymentId, verifiedPayment });
            if (problem) throw apiError(problem.status, problem.code, problem.message);
        }

        // Store the request first, in a transaction, so a crash or timeout after this point is recoverable.
        let internalId = "";
        let replayed = false;
        let stored;
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                internalId = "";
                replayed = false;
                const order = await orderModel.findById(orderId).session(session);
                if (!order) throw apiError(404, "ORDER_NOT_FOUND", "Order not found.");
                const existing = (order.refunds || []).find(record => record.idempotencyKey === idempotencyKey);
                if (existing) {
                    if (existing.amountPaise !== amountPaise) {
                        throw apiError(409, "IDEMPOTENCY_KEY_REUSED", "This request key was already used for a different refund.");
                    }
                    replayed = true;
                    internalId = existing.internalId;
                    stored = order;
                    return;
                }
                const problem = validateRefundRequest(order, { amountPaise, reason, paymentId, verifiedPayment });
                if (problem) throw apiError(problem.status, problem.code, problem.message);
                const target = paymentId || order.razorpayPaymentId;
                if (target !== order.razorpayPaymentId && verifiedPayment) registerCapturedPayment(order, verifiedPayment);
                internalId = addRequestedRefund(order, {
                    amountPaise, reason, paymentId: target, idempotencyKey
                });
                await order.save({ session });
                stored = order;
            });
        } finally {
            await session.endSession();
        }

        // A replay never contacts Razorpay again: that is what makes a double-click or retry safe.
        if (replayed) return res.json(refundResponse(stored, { replayed: true }));

        const record = stored.refunds.find(item => item.internalId === internalId);
        let gatewayRefund;
        let failure;
        try {
            gatewayRefund = await withTimeout(razorpayGateway.client().payments.refund(record.paymentId, {
                amount: record.amountPaise,
                speed: "normal",
                receipt: internalId,
                notes: { pshRefundId: internalId }
            }));
        } catch (error) {
            failure = { kind: classifyGatewayError(error), message: safeGatewayMessage(error) };
        }

        const finish = await mongoose.startSession();
        let final;
        try {
            await finish.withTransaction(async () => {
                const order = await orderModel.findById(orderId).session(finish);
                if (failure && failure.kind === "uncertain") {
                    final = order;
                    return;
                }
                if (failure) failRequestedRefund(order, internalId, failure.message);
                else {
                    // The create response is acknowledgement only; processed status must come from a webhook or sync.
                    const acknowledged = {
                        ...gatewayRefund,
                        payment_id: gatewayRefund?.payment_id || record.paymentId,
                        currency: gatewayRefund?.currency || "INR",
                        status: gatewayRefund?.status === "failed" ? "failed" : "pending"
                    };
                    const result = attachGatewayRefund(order, internalId, acknowledged);
                    if (result.error) {
                        // Razorpay answered with something that does not match what we sent: keep it for a human.
                        failure = { kind: "mismatch", message: result.error };
                    } else if (acknowledged.status === "failed") {
                        failure = { kind: "definitive", message: "Razorpay reported the refund as failed." };
                    }
                }
                await order.save({ session: finish });
                final = order;
            });
        } finally {
            await finish.endSession();
        }
        dispatchNotifications();

        if (failure?.kind === "uncertain") {
            return res.status(202).json(refundResponse(final, {
                code: "REFUND_OUTCOME_UNCERTAIN",
                message: "Razorpay did not confirm this refund. It is kept as requested; use Check refund status before trying again."
            }));
        }
        if (failure?.kind === "mismatch") {
            return res.status(502).json({ success: false, code: "REFUND_RESPONSE_MISMATCH", message: "Razorpay's response did not match the request. Check the Razorpay dashboard." });
        }
        if (failure) {
            const code = failure.kind === "rate_limited" ? "GATEWAY_RATE_LIMITED" : "REFUND_REJECTED";
            return res.status(failure.kind === "rate_limited" ? 429 : 422).json({ success: false, code, message: failure.message });
        }
        return res.status(201).json(refundResponse(final, {
            message: "Refund submitted. It stays pending until Razorpay confirms it is processed."
        }));
    } catch (error) {
        return respondError(res, error);
    }
};

export const syncRefunds = async (req, res) => {
    try {
        const { orderId } = req.body || {};
        if (typeof orderId !== "string" || !OBJECT_ID.test(orderId)) {
            return res.status(400).json({ success: false, code: "INVALID_ORDER", message: "A valid order is required." });
        }
        if (!getRazorpayTestConfig()) {
            return res.status(503).json({ success: false, code: "PAYMENTS_NOT_CONFIGURED", message: "Razorpay is not configured." });
        }
        const summary = await syncOrderRefunds(orderId);
        if (summary.notFound) return res.status(404).json({ success: false, code: "ORDER_NOT_FOUND", message: "Order not found." });
        const order = await orderModel.findById(orderId);
        return res.json(refundResponse(order, { sync: summary }));
    } catch (error) {
        return respondError(res, error);
    }
};
