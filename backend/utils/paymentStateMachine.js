import { historyEntry } from "./orderFulfillment.js";

// Central policy for prepaid (Razorpay) payment state. `paymentStatus` is the money state; the fulfilment
// status (`order.status`) is separate and `Cancelled` is a fulfilment status. A review hold is a pair of
// flags (`fulfillmentHold` + `paymentReviewRequired`) with a `paymentReviewReason`, not a payment status.
//
//   pending    -> authorized | failed | expired | paid
//   authorized -> failed | expired | paid
//   failed     -> pending (retry) | authorized | expired | paid
//   expired    -> paid            (a late capture is settled, never silently fulfilled)
//   paid       -> refunded        (only from a Razorpay-confirmed refund)
//   refunded   -> (terminal)
//   cod_pending -> paid           (COD collected after delivery)
export const PAYMENT_TRANSITIONS = Object.freeze({
    cod_pending: ["paid"],
    pending: ["authorized", "failed", "expired", "paid"],
    authorized: ["failed", "expired", "paid"],
    failed: ["pending", "authorized", "expired", "paid"],
    expired: ["paid"],
    paid: ["refunded"],
    refunded: []
});

export const REVIEW_REASONS = Object.freeze({
    STOCK_UNAVAILABLE: "stock_unavailable",
    INVENTORY_CONFLICT: "inventory_conflict",
    ORDER_CANCELLED: "order_cancelled",
    DUPLICATE_PAYMENT: "duplicate_payment",
    AUTHORIZED_ON_CLOSED_ORDER: "authorized_on_closed_order",
    PAYMENT_MISMATCH: "payment_mismatch"
});

// Holds where the order is paid but no stock has been deducted for it.
export const STOCK_NOT_DEDUCTED_REASONS = Object.freeze([
    REVIEW_REASONS.STOCK_UNAVAILABLE,
    REVIEW_REASONS.INVENTORY_CONFLICT,
    REVIEW_REASONS.ORDER_CANCELLED
]);

export const REVIEW_REASON_LABELS = Object.freeze({
    stock_unavailable: "Payment received after the reservation lapsed and stock is no longer available",
    inventory_conflict: "Payment received but the reserved stock could not be confirmed",
    order_cancelled: "Payment received for a cancelled order",
    duplicate_payment: "More than one payment was captured for this order",
    authorized_on_closed_order: "A payment was authorized after the order stopped accepting payment",
    payment_mismatch: "Razorpay captured a payment that does not match this order's amount, currency or order id"
});

export const canTransitionPayment = (from, to) =>
    from === to || (PAYMENT_TRANSITIONS[from] || []).includes(to);

const policyError = (message, code, status = 409) => Object.assign(new Error(message), { status, code });

export const recordPaymentNote = (order, note, actor = "system") => {
    order.statusHistory.push(historyEntry({
        kind: "payment",
        from: order.paymentStatus,
        to: order.paymentStatus,
        actor,
        note: String(note).slice(0, 200)
    }));
};

// Validated payment-state change. Same-state is a no-op; an unlisted transition throws a stable error.
export const transitionPayment = (order, to, { actor = "system", note } = {}) => {
    const from = order.paymentStatus;
    if (from === to) return false;
    if (!canTransitionPayment(from, to)) {
        throw policyError(`Payment cannot move from ${from} to ${to}.`, "INVALID_PAYMENT_TRANSITION");
    }
    order.statusHistory.push(historyEntry({ kind: "payment", from, to, actor, ...(note ? { note: note.slice(0, 200) } : {}) }));
    order.paymentStatus = to;
    return true;
};

export const effectiveReviewReason = order => {
    if (order?.paymentReviewReason) return order.paymentReviewReason;
    if (!order?.fulfillmentHold && !order?.paymentReviewRequired) return "";
    // Holds created before reasons were stored came from exactly two causes.
    return order.duplicatePaymentIds?.length ? REVIEW_REASONS.DUPLICATE_PAYMENT : REVIEW_REASONS.STOCK_UNAVAILABLE;
};

export const flagReview = (order, reason, { hold = true, note } = {}) => {
    order.paymentReviewRequired = true;
    order.paymentReviewReason = reason;
    if (hold) order.fulfillmentHold = true;
    if (note) recordPaymentNote(order, note);
};

const blocked = (code, message) => ({ status: 409, code, message });

// Stable, server-side answer to "may this order take another payment attempt?". Used by retry and by
// idempotent replay so neither can hand back an order that should no longer be payable.
export const getPaymentBlock = (order, { now = new Date(), allowReacquire = false } = {}) => {
    if (order.status === "Cancelled") {
        return blocked("ORDER_CANCELLED", "This order was cancelled and can no longer be paid.");
    }
    if (order.paymentStatus === "paid" || order.paymentStatus === "refunded") {
        return blocked("ORDER_ALREADY_PAID", "This order has already been paid.");
    }
    if (order.status !== "Order Placed") {
        return blocked("ORDER_NOT_PAYABLE", "This order can no longer accept payment.");
    }
    if (order.fulfillmentHold || order.paymentReviewRequired) {
        return blocked("PAYMENT_REVIEW_REQUIRED", "This order is under payment review and cannot be paid again.");
    }
    if (order.paymentStatus === "expired") {
        return blocked("PAYMENT_WINDOW_EXPIRED", "The payment window for this order has expired. Start a new checkout.");
    }
    if (order.paymentStatus === "authorized") {
        return blocked("PAYMENT_IN_PROGRESS", "A payment for this order is awaiting confirmation. Refresh your orders shortly.");
    }
    if (order.razorpaySetupStatus !== "ready" || !order.razorpayOrderId) {
        return blocked("PAYMENT_SETUP_INCOMPLETE", "Payment setup is not ready. Retry shortly or start a new checkout.");
    }
    const reservationActive = order.reservationHeld && new Date(order.reservationExpiresAt) > now;
    if (order.paymentStatus === "pending" && !reservationActive) {
        return blocked("PAYMENT_WINDOW_EXPIRED", "The payment window for this order has expired. Start a new checkout.");
    }
    if (order.paymentStatus === "failed") {
        if (order.reservationHeld && !reservationActive) {
            return blocked("PAYMENT_WINDOW_EXPIRED", "The payment window for this order has expired. Start a new checkout.");
        }
        if (!order.reservationHeld && !allowReacquire) {
            return blocked("PAYMENT_RESERVATION_RELEASED", "Stock is no longer held for this payment. Use retry payment to reserve it again.");
        }
    }
    return null;
};

// Applies a non-capture payment notification (webhook or checkout verification) to an order document.
// Returns "recorded", "unchanged", "flagged" or "ignored"; it never releases stock and never extends the
// reservation. Out-of-order and duplicate notifications are ignored rather than rejected so the provider is
// not asked to retry them.
export const applyPaymentAttempt = (order, payment, kind) => {
    if (order.paymentStatus === "paid" || order.paymentStatus === "refunded") return "ignored";
    const open = order.status !== "Cancelled" && order.reservationHeld;

    if (!open) {
        if (kind !== "authorized") return "ignored";
        if (order.paymentReviewRequired && order.paymentReviewReason) return "unchanged";
        if (payment?.id && !order.razorpayPaymentId) order.razorpayPaymentId = payment.id;
        flagReview(order, REVIEW_REASONS.AUTHORIZED_ON_CLOSED_ORDER, {
            hold: false,
            note: "Payment authorized after the order stopped accepting payment; review before any refund."
        });
        return "flagged";
    }

    if (kind === "failed") {
        // A failure for a different attempt must not undo a newer authorized attempt.
        if (order.paymentStatus === "authorized" && order.razorpayPaymentId &&
            payment?.id && payment.id !== order.razorpayPaymentId) return "ignored";
        return transitionPayment(order, "failed") ? "recorded" : "unchanged";
    }

    if (kind === "authorized") {
        if (payment?.id) order.razorpayPaymentId = payment.id;
        return transitionPayment(order, "authorized") ? "recorded" : "unchanged";
    }
    return "ignored";
};
