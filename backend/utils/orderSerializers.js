import { allowedNextStatuses } from "./orderFulfillment.js";
import { adminRefundView, customerRefundStatus } from "./refunds.js";
import { effectiveReviewReason } from "./paymentStateMachine.js";

const plainOrder = order => (order?.toObject ? order.toObject() : order);

export const withDisplayAmounts = order => {
    const data = plainOrder(order);
    const items = (data.items || []).map(item => ({
        ...item,
        price: Number.isSafeInteger(item.unitPricePaise) ? item.unitPricePaise / 100 : item.price,
        image: Array.isArray(item.image) ? item.image : []
    }));
    const amount = Number.isSafeInteger(data.totalPaise) ? data.totalPaise / 100 : data.amount;
    return { ...data, items, amount };
};

export const serializeAdminOrder = order => {
    const data = withDisplayAmounts(order);
    // Replaces the raw refund records so idempotency keys never reach the browser.
    return { ...data, ...adminRefundView(data), allowedStatuses: allowedNextStatuses(data) };
};

// Customer-facing reference derived from the order id (last 12 hex characters), so no schema change is needed.
// It is a display aid, not a guaranteed-unique key. Mirrors frontend formatOrderReference exactly.
export const orderReference = id => {
    const value = String(id ?? "");
    return /^[0-9a-f]{12,}$/i.test(value) ? `PSH-${value.slice(-12).toUpperCase()}` : "";
};

// Coarse customer-safe category for an order under payment review. The internal reason, gateway data and anomaly
// ids are never exposed; the category only selects which reassuring message the customer sees.
export const customerPaymentIssue = data => {
    if (!data.paymentReviewRequired && !data.fulfillmentHold) return "";
    switch (effectiveReviewReason(data)) {
        case "stock_unavailable":
        case "inventory_conflict": return "stock";
        case "order_cancelled": return "cancelled_capture";
        case "duplicate_payment": return "duplicate";
        default: return "review";
    }
};

// Explicit allow-list: internal notes, review flags, idempotency keys and gateway identifiers never reach customers.
export const serializeCustomerOrder = order => {
    const data = withDisplayAmounts(order);
    const shipping = data.shipping || {};
    return {
        _id: data._id,
        orderReference: orderReference(data._id),
        date: data.date,
        createdAt: data.createdAt,
        items: data.items.map(item => ({
            productId: item.productId,
            variantId: item.variantId,
            sku: item.sku,
            name: item.name,
            image: item.image,
            quantity: item.quantity,
            price: item.price,
            size: item.size
        })),
        amount: data.amount,
        subtotalPaise: data.subtotalPaise,
        shippingPaise: data.shippingPaise,
        totalPaise: data.totalPaise,
        address: data.address,
        status: data.status,
        paymentMethod: data.paymentMethod,
        payment: data.payment,
        paymentStatus: data.paymentStatus,
        paidAt: data.paidAt,
        refundedPaise: data.refundedPaise || 0,
        refundStatus: customerRefundStatus(data),
        fulfillmentHold: Boolean(data.fulfillmentHold),
        paymentIssue: customerPaymentIssue(data),
        reservationHeld: Boolean(data.reservationHeld),
        reservationExpiresAt: data.reservationExpiresAt,
        shipping: {
            courierName: shipping.courierName || "",
            trackingNumber: shipping.trackingNumber || "",
            trackingUrl: shipping.trackingUrl || "",
            dispatchDate: shipping.dispatchDate
        },
        timeline: (data.statusHistory || []).map(entry => ({ kind: entry.kind, status: entry.to, at: entry.at }))
    };
};
