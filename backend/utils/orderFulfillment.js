// Fulfilment status only. Payment state lives in `paymentStatus` and is never derived from these values.
const statusTransitions = {
    "Order Placed": ["Processing", "Packing", "Packed", "Cancelled"],
    Processing: ["Packing", "Packed", "Cancelled"],
    Packing: ["Packed", "Cancelled"],
    Packed: ["Shipped", "Cancelled"],
    Shipped: ["Out for delivery"],
    "Out for delivery": ["Delivered"],
    Delivered: ["Return Requested"],
    "Return Requested": ["Return Approved", "Delivered"],
    "Return Approved": [],
    Cancelled: []
};

export const FULFILLMENT_STATUSES = Object.freeze(Object.keys(statusTransitions));
export const SHIPPING_STATUSES = Object.freeze(["Shipped", "Out for delivery", "Delivered"]);
// Statuses that need a prepaid order to be paid and not on payment-review hold.
export const PHYSICAL_FULFILMENT_STATUSES = Object.freeze([
    "Processing", "Packing", "Packed", "Shipped", "Out for delivery", "Delivered"
]);

const cleanText = value => typeof value === "string" ? value.trim() : value;

export const isValidFulfillmentTransition = (currentStatus, nextStatus) =>
    currentStatus === nextStatus ||
    (statusTransitions[currentStatus] || []).includes(nextStatus);

export const allowedNextStatuses = order => {
    const current = order?.status;
    const next = [current, ...(statusTransitions[current] || [])];
    return next.filter(status => {
        if (status === current) return true;
        if (PHYSICAL_FULFILMENT_STATUSES.includes(status) && !isEligibleForPrepaidFulfillment(order)) return false;
        if (status === "Shipped" && !hasDispatchDetails(order?.shipping)) return false;
        return true;
    });
};

export const historyEntry = ({ kind, from, to, actor, note }) => ({
    kind,
    from: from ?? "",
    to,
    at: new Date(),
    actor: actor === "admin" || actor === "customer" ? actor : "system",
    ...(note ? { note } : {})
});

export const recordFulfilmentStatus = (order, to, actor) => {
    if (order.status === to) return false;
    order.statusHistory.push(historyEntry({ kind: "fulfilment", from: order.status, to, actor }));
    order.status = to;
    return true;
};

export const recordPaymentStatus = (order, to, actor = "system") => {
    if (order.paymentStatus === to) return false;
    order.statusHistory.push(historyEntry({ kind: "payment", from: order.paymentStatus, to, actor }));
    order.paymentStatus = to;
    return true;
};

export const normalizeShippingDetails = shipping => {
    if (!shipping || typeof shipping !== "object" || Array.isArray(shipping)) {
        return { error: "Shipping details must be an object." };
    }

    const allowedKeys = new Set(["courierName", "trackingNumber", "trackingUrl", "notes"]);
    if (Object.keys(shipping).some(key => !allowedKeys.has(key))) {
        return { error: "Shipping details contain an unsupported field." };
    }

    const values = {
        courierName: cleanText(shipping.courierName ?? ""),
        trackingNumber: cleanText(shipping.trackingNumber ?? ""),
        trackingUrl: cleanText(shipping.trackingUrl ?? ""),
        notes: cleanText(shipping.notes ?? "")
    };
    const maxLengths = {
        courierName: 100,
        trackingNumber: 100,
        trackingUrl: 2048,
        notes: 1000
    };

    for (const [field, value] of Object.entries(values)) {
        if (typeof value !== "string" || value.length > maxLengths[field]) {
            return { error: `Shipping ${field} must be text no longer than ${maxLengths[field]} characters.` };
        }
        if (/[\u0000-\u001f\u007f]/.test(value)) {
            return { error: `Shipping ${field} contains unsupported characters.` };
        }
    }

    if (values.trackingUrl) {
        try {
            const url = new URL(values.trackingUrl);
            if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
                return { error: "Tracking URL must be a valid HTTPS URL." };
            }
        } catch {
            return { error: "Tracking URL must be a valid HTTPS URL." };
        }
    }

    return { shipping: values };
};

export const hasDispatchDetails = shipping =>
    Boolean(shipping?.courierName?.trim() && shipping?.trackingNumber?.trim());

export const isEligibleForPrepaidFulfillment = order =>
    order?.paymentMethod !== "Razorpay" ||
    (order.paymentStatus === "paid" && !order.fulfillmentHold);
