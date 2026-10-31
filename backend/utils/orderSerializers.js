import { allowedNextStatuses } from "./orderFulfillment.js";

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
    return { ...data, allowedStatuses: allowedNextStatuses(data) };
};

// Explicit allow-list: internal notes, review flags, idempotency keys and gateway identifiers never reach customers.
export const serializeCustomerOrder = order => {
    const data = withDisplayAmounts(order);
    const shipping = data.shipping || {};
    return {
        _id: data._id,
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
        fulfillmentHold: Boolean(data.fulfillmentHold),
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
