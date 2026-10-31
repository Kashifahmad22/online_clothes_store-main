import { recordPaymentStatus } from "./orderFulfillment.js";

export const codCollectionError = order => {
    if (!order) return "Order not found.";
    if (order.paymentMethod !== "COD") return "Only cash-on-delivery orders can be marked collected.";
    if (order.paymentStatus !== "cod_pending") return "Cash on delivery has already been settled for this order.";
    if (order.status !== "Delivered") return "Cash can only be marked collected after the order is delivered.";
    return null;
};

export const markCodCollected = (order, actor = "admin") => {
    const error = codCollectionError(order);
    if (error) return { error };
    order.payment = true;
    recordPaymentStatus(order, "paid", actor);
    order.paidAt = new Date();
    return { applied: true };
};

/**
 * Applies a provider-confirmed (`refund.processed`) refund. Requesting a refund never reaches this function,
 * so a refund is only ever recorded as successful after Razorpay reports it processed.
 */
export const applyProcessedRefund = (order, refund) => {
    if (!refund || typeof refund.id !== "string" || !refund.id) return { error: "Refund payload is invalid." };
    if (refund.status !== "processed") return { ignored: "not_processed" };
    if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0) return { error: "Refund amount is invalid." };
    if (refund.currency && refund.currency !== "INR") return { error: "Refund currency does not match the order." };
    if (order.paymentMethod !== "Razorpay" || !["paid", "refunded"].includes(order.paymentStatus)) {
        return { error: "Order has no captured payment to refund." };
    }
    if (order.razorpayPaymentId && refund.payment_id && refund.payment_id !== order.razorpayPaymentId) {
        return { error: "Refund payment does not match the order." };
    }
    if ((order.refunds || []).some(item => item.refundId === refund.id)) return { duplicate: true };

    const refundedPaise = (order.refundedPaise || 0) + refund.amount;
    if (refundedPaise > order.totalPaise) return { error: "Refund exceeds the order total." };

    order.refunds.push({ refundId: refund.id, amountPaise: refund.amount, processedAt: new Date() });
    order.refundedPaise = refundedPaise;
    if (refundedPaise === order.totalPaise) recordPaymentStatus(order, "refunded", "system");
    return { applied: true, fullyRefunded: refundedPaise === order.totalPaise };
};
