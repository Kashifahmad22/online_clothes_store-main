import { paymentBalances } from "./refunds.js";
import { REVIEW_REASONS, STOCK_NOT_DEDUCTED_REASONS, effectiveReviewReason } from "./paymentStateMachine.js";

const allow = () => ({ allowed: true });
const deny = (code, message) => ({ allowed: false, code, message });

// What an admin may do about a payment review, decided in one place so the API and the admin screen agree.
// `openMismatchCount` is the number of unresolved captured_payment_mismatch anomalies linked to the order.
// Neither action can refund, restock, or clear a hold on its own authority: each is only allowed when the
// evidence on the order shows the underlying problem is already dealt with.
export const reviewState = (order, { openMismatchCount = 0 } = {}) => {
    const pending = Boolean(order.fulfillmentHold || order.paymentReviewRequired);
    const reason = effectiveReviewReason(order);
    const stockNotDeducted = STOCK_NOT_DEDUCTED_REASONS.includes(reason);
    const cancelled = order.status === "Cancelled";
    const additional = paymentBalances(order).filter(balance => balance.role === "additional");
    const unrefundedAdditional = additional.filter(balance => balance.processedPaise < balance.capturedPaise);

    const base = { pending, reason, cancelled, stockDeducted: order.paymentStatus === "paid" && !stockNotDeducted };
    if (!pending) {
        const none = deny("NO_REVIEW_PENDING", "This order has no payment review pending.");
        return { ...base, release: none, acknowledge: none };
    }

    let release = allow();
    if (order.paymentStatus !== "paid" || !order.razorpayPaymentId || cancelled || order.status !== "Order Placed" ||
        !stockNotDeducted || reason === REVIEW_REASONS.ORDER_CANCELLED) {
        release = deny("REVIEW_NOT_RELEASABLE", "This review cannot be released for fulfilment.");
    }

    let acknowledge = allow();
    if (stockNotDeducted && !cancelled) {
        acknowledge = deny("ACKNOWLEDGE_NOT_ALLOWED",
            "Release the order (which re-acquires stock) or cancel it; it cannot simply be acknowledged.");
    } else if (reason === REVIEW_REASONS.ORDER_CANCELLED && order.paymentStatus !== "refunded") {
        acknowledge = deny("REFUND_REQUIRED",
            "The customer's payment for this cancelled order is not confirmed as refunded. Refund it first.");
    } else if (unrefundedAdditional.length > 0) {
        acknowledge = deny("ADDITIONAL_PAYMENT_UNREFUNDED",
            "An additional captured payment has not been confirmed as refunded. Refund it first.");
    } else if (reason === REVIEW_REASONS.PAYMENT_MISMATCH && openMismatchCount > 0) {
        acknowledge = deny("MISMATCH_UNRESOLVED",
            "Mismatched payment evidence for this order is still open. Refund or resolve it first.");
    }
    return { ...base, release, acknowledge };
};
