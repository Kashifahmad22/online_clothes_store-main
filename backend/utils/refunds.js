import { randomUUID } from "node:crypto";
import { recordPaymentStatus } from "./orderFulfillment.js";
import { recordPaymentNote } from "./paymentStateMachine.js";

// Refund lifecycle policy. All amounts are integer paise. A refund record moves only forward:
//
//   requested -> pending | processed | failed
//   pending   -> processed | failed
//   failed    -> processed   (Razorpay is the authority: a refund it later reports processed was processed)
//   processed -> (terminal; an older or duplicate event can never downgrade it)
//
// "requested" means the request is stored but Razorpay has not yet acknowledged it (or the outcome is
// unknown after a timeout). Only a refund.processed event (or a gateway fetch reporting "processed")
// ever produces "processed"; the response to the create call never does.
export const REFUND_STATUSES = Object.freeze(["requested", "pending", "processed", "failed"]);
export const IN_FLIGHT_STATUSES = Object.freeze(["requested", "pending"]);
const GATEWAY_STATUSES = ["pending", "processed", "failed"];
export const FAILED_REFUND_NOTE = "Razorpay reported this refund as failed. Check the Razorpay dashboard for the reason.";
export const STALE_REQUEST_MS = 30 * 60 * 1000;

const ALLOWED_MOVES = { requested: ["pending", "processed", "failed"], pending: ["processed", "failed"], failed: ["processed"], processed: [] };

// Records written before this lifecycle existed were only ever stored once processed.
export const refundStatusOf = record => record?.status || "processed";

const paymentOf = (order, record) => record.paymentId || order.razorpayPaymentId || "";

export const formatPaise = paise => `₹${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;

export const capturedEntryOf = (order, paymentId) =>
    (order.capturedPayments || []).find(entry => entry.paymentId === paymentId);

const isRegisteredSecondary = (order, paymentId) =>
    (order.duplicatePaymentIds || []).includes(paymentId) || Boolean(capturedEntryOf(order, paymentId));

// The primary payment is only ever accepted when it equals totalPaise exactly. A secondary payment has its own
// verified amount; a legacy duplicate with no recorded amount falls back to the order total.
export const capturedAmountOf = (order, paymentId = order.razorpayPaymentId, verifiedAmount) => {
    if (paymentId === order.razorpayPaymentId) return order.totalPaise || 0;
    return capturedEntryOf(order, paymentId)?.amountPaise ?? verifiedAmount ?? (order.totalPaise || 0);
};

export const refundTotals = (order, paymentId = order.razorpayPaymentId, verifiedAmount) => {
    let processed = 0;
    let inFlight = 0;
    let failed = 0;
    for (const record of order.refunds || []) {
        if (paymentOf(order, record) !== paymentId) continue;
        const amount = record.amountPaise || 0;
        const status = refundStatusOf(record);
        if (status === "processed") processed += amount;
        else if (status === "failed") failed += amount;
        else inFlight += amount;
    }
    // `refundedPaise` predates per-record status, so it can only raise the processed figure.
    if (paymentId === order.razorpayPaymentId) processed = Math.max(processed, order.refundedPaise || 0);
    const capturedPaise = capturedAmountOf(order, paymentId, verifiedAmount);
    return {
        capturedPaise,
        processedPaise: processed,
        inFlightPaise: inFlight,
        failedPaise: failed,
        remainingPaise: Math.max(0, capturedPaise - processed - inFlight)
    };
};

const refundError = (status, code, message) => ({ status, code, message });

// `verifiedPayment` is the payment as fetched from Razorpay by the caller. A payment other than the order's
// primary one can only be refunded with it, and only while the order is under payment review (or the payment
// was already registered as a duplicate/secondary capture). Razorpay itself must bind it to this order.
export const validateRefundRequest = (order, { amountPaise, reason, paymentId, verifiedPayment }) => {
    if (!order || order.paymentMethod !== "Razorpay") {
        return refundError(409, "REFUND_NOT_SUPPORTED", "Only prepaid Razorpay orders can be refunded here.");
    }
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        return refundError(400, "INVALID_AMOUNT", "Refund amount must be a positive whole number of paise.");
    }
    if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(reason)) {
        return refundError(400, "REASON_REQUIRED", "Enter a reason of 5 to 120 characters for this refund.");
    }
    const primary = order.razorpayPaymentId;
    const target = paymentId || primary;
    if (!target) return refundError(409, "NO_CAPTURED_PAYMENT", "This order has no recorded captured payment.");
    const isPrimary = target === primary;
    if (isPrimary) {
        if (order.paymentStatus === "refunded") {
            return refundError(409, "REFUND_ALREADY_COMPLETE", "This order has already been fully refunded.");
        }
        if (order.paymentStatus !== "paid") {
            return refundError(409, "NO_CAPTURED_PAYMENT", "A refund needs a captured payment; this order has none.");
        }
    } else {
        const registered = capturedEntryOf(order, target);
        const duplicate = (order.duplicatePaymentIds || []).includes(target);
        if (!order.paymentReviewRequired && !registered && !duplicate) {
            return refundError(400, "PAYMENT_NOT_ON_ORDER", "That payment is not recorded against this order and the order is not under payment review.");
        }
        if (verifiedPayment) {
            const bound = verifiedPayment.id === target && verifiedPayment.order_id &&
                verifiedPayment.order_id === order.razorpayOrderId &&
                verifiedPayment.currency === "INR" && Number.isSafeInteger(verifiedPayment.amount) && verifiedPayment.amount > 0;
            if (!bound) return refundError(409, "PAYMENT_NOT_ON_ORDER", "Razorpay does not bind this payment to this order.");
            if (registered && registered.amountPaise !== verifiedPayment.amount) {
                return refundError(409, "PAYMENT_AMOUNT_CHANGED", "The captured amount no longer matches what was verified earlier.");
            }
        } else if (!registered && !duplicate) {
            return refundError(409, "PAYMENT_NOT_VERIFIED", "This payment must be verified with Razorpay before it can be refunded.");
        }
    }
    if ((order.refunds || []).some(record => paymentOf(order, record) === target && refundStatusOf(record) === "requested")) {
        return refundError(409, "REFUND_IN_DOUBT", "An earlier refund request is still unconfirmed. Check its status before requesting another.");
    }
    const { remainingPaise } = refundTotals(order, target, verifiedPayment?.amount);
    if (amountPaise > remainingPaise) {
        return refundError(409, "REFUND_EXCEEDS_CAPTURED",
            `Only ${formatPaise(remainingPaise)} can still be refunded (processed and pending refunds are counted).`);
    }
    return null;
};

export const addRequestedRefund = (order, { amountPaise, reason, paymentId, idempotencyKey, now = new Date() }) => {
    const internalId = randomUUID();
    order.refunds.push({
        internalId,
        paymentId,
        amountPaise,
        currency: "INR",
        status: "requested",
        reason: reason.trim(),
        initiatedBy: "admin",
        idempotencyKey,
        requestedAt: now,
        updatedAt: now
    });
    recordPaymentNote(order, `Refund of ${formatPaise(amountPaise)} requested (not yet confirmed by Razorpay).`, "admin");
    return internalId;
};

export const findRefundByInternalId = (order, internalId) =>
    (order.refunds || []).find(record => record.internalId === internalId);

// Applies Razorpay-reported refund state (webhook payload or a gateway fetch) to an order. It never
// trusts the order a payload claims to belong to: payment id, amount and currency must all match.
export const applyRefund = (order, refund, { now = new Date() } = {}) => {
    if (!refund || typeof refund.id !== "string" || !refund.id) return { error: "Refund payload is invalid." };
    const target = refund.status;
    if (!GATEWAY_STATUSES.includes(target)) return { ignored: "unsupported_status" };
    if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0) return { error: "Refund amount is invalid." };
    if (refund.currency && refund.currency !== "INR") return { error: "Refund currency does not match the order." };
    if (order.paymentMethod !== "Razorpay") return { error: "Order has no captured payment to refund." };
    const paymentId = refund.payment_id;
    if (typeof paymentId !== "string" || !paymentId) return { error: "Refund payment is missing." };
    const hasCapture = ["paid", "refunded"].includes(order.paymentStatus);
    const registered = isRegisteredSecondary(order, paymentId);
    // A paid order whose payment id was never stored (order.paid webhook) adopts the id from the signed payload.
    if (!order.razorpayPaymentId && hasCapture && !registered) order.razorpayPaymentId = paymentId;
    const isPrimary = paymentId === order.razorpayPaymentId;
    if (isPrimary && !hasCapture) return { error: "Order has no captured payment to refund." };
    if (!isPrimary && !registered) {
        return { error: hasCapture ? "Refund payment does not match the order." : "Order has no captured payment to refund." };
    }

    const records = order.refunds || [];
    let record = records.find(item => item.refundId === refund.id);
    const internalId = typeof refund.notes?.pshRefundId === "string" ? refund.notes.pshRefundId : "";
    if (!record && internalId) record = records.find(item => item.internalId === internalId && !item.refundId);

    if (record) {
        if (record.amountPaise !== refund.amount || paymentOf(order, record) !== paymentId) {
            return { error: "Refund does not match the recorded request." };
        }
        const from = refundStatusOf(record);
        if (from === target) return { duplicate: true };
        if (!ALLOWED_MOVES[from].includes(target)) return { ignored: "stale_event" };
        if (target === "processed" && isPrimary && (order.refundedPaise || 0) + refund.amount > order.totalPaise) {
            return { error: "Refund exceeds the order total." };
        }
        record.refundId = record.refundId || refund.id;
        record.status = target;
        record.updatedAt = now;
    } else {
        if (target !== "failed") {
            const { remainingPaise } = refundTotals(order, paymentId);
            if (refund.amount > remainingPaise) return { error: "Refund exceeds the order total." };
        }
        // Matched by captured payment id, amount and currency, e.g. a refund made in the Razorpay dashboard.
        order.refunds.push({
            refundId: refund.id,
            paymentId,
            amountPaise: refund.amount,
            currency: "INR",
            status: target,
            reason: "Created outside this admin panel",
            initiatedBy: "gateway",
            requestedAt: now,
            updatedAt: now
        });
        record = order.refunds[order.refunds.length - 1];
    }
    if (target === "processed") {
        record.processedAt = now;
        record.failureReason = undefined;
        if (isPrimary) order.refundedPaise = (order.refundedPaise || 0) + refund.amount;
    }
    if (target === "failed") record.failureReason = FAILED_REFUND_NOTE;

    // The order is only "refunded" once every verified secondary capture is refunded too.
    const secondaryOutstanding = (order.capturedPayments || []).some(entry =>
        entry.paymentId !== order.razorpayPaymentId && refundTotals(order, entry.paymentId).processedPaise < entry.amountPaise);
    const fullyRefunded = (order.refundedPaise || 0) === order.totalPaise && !secondaryOutstanding;
    const completesOrder = target === "processed" && fullyRefunded;
    if (completesOrder) recordPaymentStatus(order, "refunded", "system");
    return { applied: true, status: target, becameProcessed: target === "processed", fullyRefunded: completesOrder };
};

// Records a payment Razorpay confirmed as captured for this order's Razorpay order, so it has its own balance.
export const registerCapturedPayment = (order, payment, now = new Date()) => {
    if (capturedEntryOf(order, payment.id) || payment.id === order.razorpayPaymentId) return false;
    order.capturedPayments.push({
        paymentId: payment.id,
        razorpayOrderId: payment.order_id,
        amountPaise: payment.amount,
        currency: "INR",
        verifiedAt: now
    });
    return true;
};

export const attachGatewayRefund = (order, internalId, refund, now = new Date()) =>
    applyRefund(order, { ...refund, notes: { ...(refund.notes || {}), pshRefundId: internalId } }, { now });

// A definitive rejection (the request never created a refund) releases the amount it was holding.
export const failRequestedRefund = (order, internalId, detail, now = new Date()) => {
    const record = findRefundByInternalId(order, internalId);
    if (!record || refundStatusOf(record) !== "requested") return false;
    record.status = "failed";
    record.failureReason = String(detail || FAILED_REFUND_NOTE).slice(0, 200);
    record.updatedAt = now;
    recordPaymentNote(order, `Refund of ${formatPaise(record.amountPaise)} was not created at Razorpay.`, "system");
    return true;
};

export const publicRefund = (order, record) => ({
    internalId: record.internalId || "",
    refundId: record.refundId || "",
    paymentId: paymentOf(order, record),
    amountPaise: record.amountPaise,
    currency: record.currency || "INR",
    status: refundStatusOf(record),
    reason: record.reason || "",
    initiatedBy: record.initiatedBy || "gateway",
    failureReason: record.failureReason || "",
    requestedAt: record.requestedAt || null,
    updatedAt: record.updatedAt || record.processedAt || null,
    processedAt: record.processedAt || null
});

// One balance per captured payment id the order knows about, so the admin never reads a combined figure.
export const paymentBalances = order => {
    const ids = [];
    if (order.razorpayPaymentId) ids.push(order.razorpayPaymentId);
    for (const id of [...(order.duplicatePaymentIds || []), ...(order.capturedPayments || []).map(entry => entry.paymentId)]) {
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids.map(paymentId => ({
        paymentId,
        role: paymentId === order.razorpayPaymentId ? "primary" : "additional",
        verified: paymentId === order.razorpayPaymentId || Boolean(capturedEntryOf(order, paymentId)),
        ...refundTotals(order, paymentId)
    }));
};

export const adminRefundView = order => ({
    refunds: (order.refunds || []).map(record => publicRefund(order, record)),
    refundSummary: refundTotals(order),
    paymentBalances: paymentBalances(order)
});

// Customer wording is deliberately coarse: no gateway ids, failure details or internal states.
export const customerRefundStatus = order => {
    if (order.paymentStatus === "refunded") return "refunded";
    const totals = refundTotals(order);
    if (totals.inFlightPaise > 0) return "pending";
    if (totals.processedPaise > 0) return "partial";
    if (totals.failedPaise > 0 && (order.refunds || []).every(record => refundStatusOf(record) === "failed")) return "failed";
    return "none";
};
