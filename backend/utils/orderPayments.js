import { recordPaymentStatus } from "./orderFulfillment.js";
import { applyRefund } from "./refunds.js";

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
    if (refund && typeof refund.id === "string" && refund.id && refund.status !== "processed") return { ignored: "not_processed" };
    const result = applyRefund(order, refund);
    return result.applied ? { applied: true, fullyRefunded: result.fullyRefunded } : result;
};