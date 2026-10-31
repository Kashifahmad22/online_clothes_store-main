import test from "node:test";
import assert from "node:assert/strict";
import {
    FULFILLMENT_STATUSES,
    allowedNextStatuses,
    isValidFulfillmentTransition,
    recordFulfilmentStatus,
    recordPaymentStatus
} from "../utils/orderFulfillment.js";
import { applyProcessedRefund, markCodCollected } from "../utils/orderPayments.js";
import { serializeAdminOrder, serializeCustomerOrder } from "../utils/orderSerializers.js";

const makeOrder = overrides => ({
    _id: "665f1c2e8f1b2c0012345678",
    userId: "user-1",
    status: "Order Placed",
    paymentMethod: "COD",
    paymentStatus: "cod_pending",
    totalPaise: 250000,
    refundedPaise: 0,
    refunds: [],
    statusHistory: [],
    shipping: { courierName: "", trackingNumber: "", trackingUrl: "", notes: "internal only" },
    items: [{ name: "Silk Saree", sku: "SKU-1", quantity: 1, unitPricePaise: 250000, image: [] }],
    ...overrides
});

test("valid fulfilment transitions cover the full forward path and the return branch", () => {
    const path = ["Order Placed", "Processing", "Packed", "Shipped", "Out for delivery", "Delivered",
        "Return Requested", "Return Approved"];
    for (let index = 0; index < path.length - 1; index += 1) {
        assert.equal(isValidFulfillmentTransition(path[index], path[index + 1]), true, path[index]);
    }
    assert.equal(isValidFulfillmentTransition("Return Requested", "Delivered"), true);
    assert.ok(FULFILLMENT_STATUSES.includes("Return Approved"));
});

test("invalid transitions are rejected: no skipping, no reversal, no leaving terminal states", () => {
    assert.equal(isValidFulfillmentTransition("Shipped", "Delivered"), false);
    assert.equal(isValidFulfillmentTransition("Order Placed", "Delivered"), false);
    assert.equal(isValidFulfillmentTransition("Delivered", "Cancelled"), false);
    assert.equal(isValidFulfillmentTransition("Shipped", "Cancelled"), false);
    assert.equal(isValidFulfillmentTransition("Cancelled", "Processing"), false);
    assert.equal(isValidFulfillmentTransition("Return Approved", "Delivered"), false);
    assert.equal(isValidFulfillmentTransition("Packed", "Return Requested"), false);
    assert.equal(isValidFulfillmentTransition("Unknown", "Processing"), false);
});

test("allowed next statuses hide shipping until dispatch details exist and block unpaid prepaid orders", () => {
    const cod = makeOrder({ status: "Packed" });
    assert.deepEqual(allowedNextStatuses(cod), ["Packed", "Cancelled"]);
    const dispatchable = makeOrder({ status: "Packed", shipping: { courierName: "C", trackingNumber: "T" } });
    assert.deepEqual(allowedNextStatuses(dispatchable), ["Packed", "Shipped", "Cancelled"]);
    const unpaid = makeOrder({ paymentMethod: "Razorpay", paymentStatus: "pending" });
    assert.deepEqual(allowedNextStatuses(unpaid), ["Order Placed", "Cancelled"]);
    const held = makeOrder({ paymentMethod: "Razorpay", paymentStatus: "paid", fulfillmentHold: true });
    assert.deepEqual(allowedNextStatuses(held), ["Order Placed", "Cancelled"]);
});

test("status history records the actor and keeps fulfilment and payment separate", () => {
    const order = makeOrder({ status: "Packed", shipping: { courierName: "C", trackingNumber: "T" } });
    assert.equal(recordFulfilmentStatus(order, "Shipped", "admin"), true);
    assert.equal(order.status, "Shipped");
    assert.equal(order.paymentStatus, "cod_pending");
    assert.equal(recordFulfilmentStatus(order, "Shipped", "admin"), false);
    assert.equal(recordPaymentStatus(order, "paid"), true);
    assert.equal(recordPaymentStatus(order, "paid"), false);
    assert.equal(order.statusHistory.length, 2);
    assert.deepEqual(
        order.statusHistory.map(({ kind, from, to, actor }) => ({ kind, from, to, actor })),
        [
            { kind: "fulfilment", from: "Packed", to: "Shipped", actor: "admin" },
            { kind: "payment", from: "cod_pending", to: "paid", actor: "system" }
        ]
    );
    assert.ok(order.statusHistory.every(entry => entry.at instanceof Date));
});

test("delivering a COD order does not mark cash as collected; collection is an explicit step", () => {
    const order = makeOrder({ status: "Delivered" });
    assert.equal(order.paymentStatus, "cod_pending");
    assert.deepEqual(markCodCollected(order), { applied: true });
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.payment, true);
    assert.ok(markCodCollected(order).error);
});

test("COD collection is refused before delivery and for prepaid orders", () => {
    assert.match(markCodCollected(makeOrder({ status: "Shipped" })).error, /after the order is delivered/);
    assert.match(markCodCollected(makeOrder({ paymentMethod: "Razorpay", status: "Delivered" })).error, /cash-on-delivery/);
    assert.ok(markCodCollected(null).error);
});

const prepaid = overrides => makeOrder({
    paymentMethod: "Razorpay",
    paymentStatus: "paid",
    razorpayPaymentId: "pay_1",
    ...overrides
});

test("a processed full refund marks the payment refunded exactly once", () => {
    const order = prepaid();
    const refund = { id: "rfnd_1", payment_id: "pay_1", amount: 250000, currency: "INR", status: "processed" };
    assert.deepEqual(applyProcessedRefund(order, refund), { applied: true, fullyRefunded: true });
    assert.equal(order.paymentStatus, "refunded");
    assert.equal(order.refundedPaise, 250000);
    assert.deepEqual(applyProcessedRefund(order, refund), { duplicate: true });
    assert.equal(order.refunds.length, 1);
    assert.equal(order.statusHistory.filter(entry => entry.to === "refunded").length, 1);
});

test("partial refunds accumulate without changing the payment status until fully refunded", () => {
    const order = prepaid();
    const first = applyProcessedRefund(order, { id: "rfnd_1", payment_id: "pay_1", amount: 100000, status: "processed" });
    assert.deepEqual(first, { applied: true, fullyRefunded: false });
    assert.equal(order.paymentStatus, "paid");
    const second = applyProcessedRefund(order, { id: "rfnd_2", payment_id: "pay_1", amount: 150000, status: "processed" });
    assert.equal(second.fullyRefunded, true);
    assert.equal(order.paymentStatus, "refunded");
});

test("a refund that is not processed, or does not match the order, never changes the order", () => {
    const order = prepaid();
    assert.deepEqual(
        applyProcessedRefund(order, { id: "rfnd_1", payment_id: "pay_1", amount: 1000, status: "pending" }),
        { ignored: "not_processed" }
    );
    assert.ok(applyProcessedRefund(order, { id: "rfnd_2", payment_id: "pay_other", amount: 1000, status: "processed" }).error);
    assert.ok(applyProcessedRefund(order, { id: "rfnd_3", payment_id: "pay_1", amount: 250001, status: "processed" }).error);
    assert.ok(applyProcessedRefund(order, { id: "rfnd_4", payment_id: "pay_1", amount: 1000, currency: "USD", status: "processed" }).error);
    assert.ok(applyProcessedRefund(order, { id: "rfnd_5", payment_id: "pay_1", amount: -5, status: "processed" }).error);
    assert.ok(applyProcessedRefund(makeOrder(), { id: "rfnd_6", payment_id: "pay_1", amount: 1000, status: "processed" }).error);
    assert.ok(applyProcessedRefund(prepaid({ paymentStatus: "pending" }), { id: "rfnd_7", amount: 1000, status: "processed" }).error);
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.refundedPaise, 0);
    assert.equal(order.refunds.length, 0);
});

test("customer serialization is an allow-list that hides internal fields", () => {
    const order = prepaid({
        idempotencyKey: "secret-key",
        duplicatePaymentIds: ["pay_dup"],
        paymentReviewRequired: true,
        razorpayOrderId: "order_1",
        fulfillmentHold: true,
        statusHistory: [{ kind: "fulfilment", from: "", to: "Order Placed", at: new Date(), actor: "admin", note: "x" }]
    });
    const customer = serializeCustomerOrder(order);
    for (const hidden of ["idempotencyKey", "duplicatePaymentIds", "paymentReviewRequired", "razorpayOrderId",
        "razorpayPaymentId", "statusHistory", "userId"]) {
        assert.equal(hidden in customer, false, hidden);
    }
    assert.equal("notes" in customer.shipping, false);
    assert.equal(customer.fulfillmentHold, true);
    assert.equal(customer.amount, 2500);
    assert.deepEqual(Object.keys(customer.timeline[0]).sort(), ["at", "kind", "status"]);
});

test("admin serialization keeps internal data and adds the permitted next statuses", () => {
    const admin = serializeAdminOrder(prepaid({ status: "Order Placed" }));
    assert.equal(admin.shipping.notes, "internal only");
    assert.deepEqual(admin.allowedStatuses, ["Order Placed", "Processing", "Packing", "Packed", "Cancelled"]);
});
