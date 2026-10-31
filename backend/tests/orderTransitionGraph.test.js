import assert from "node:assert/strict";
import test from "node:test";
import {
    FULFILLMENT_STATUSES,
    allowedNextStatuses,
    isValidFulfillmentTransition,
    recordFulfilmentStatus,
    recordPaymentStatus
} from "../utils/orderFulfillment.js";
import { markCodCollected } from "../utils/orderPayments.js";

const EXPECTED = {
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

const shipping = { courierName: "Courier", trackingNumber: "T123" };
const makeOrder = overrides => ({
    paymentMethod: "COD",
    paymentStatus: "cod_pending",
    status: "Order Placed",
    fulfillmentHold: false,
    shipping,
    statusHistory: [],
    ...overrides
});

test("the full status matrix matches the documented graph exactly", () => {
    assert.deepEqual([...FULFILLMENT_STATUSES].sort(), Object.keys(EXPECTED).sort());
    for (const from of FULFILLMENT_STATUSES) {
        for (const to of FULFILLMENT_STATUSES) {
            const expected = from === to || EXPECTED[from].includes(to);
            assert.equal(isValidFulfillmentTransition(from, to), expected, `${from} -> ${to}`);
        }
    }
    assert.equal(isValidFulfillmentTransition("Order Placed", "Nonsense"), false);
    assert.equal(isValidFulfillmentTransition("Nonsense", "Processing"), false);
});

test("the normal path is walkable step by step and is recorded in history", () => {
    const order = makeOrder();
    const path = ["Processing", "Packing", "Packed", "Shipped", "Out for delivery", "Delivered"];
    for (const next of path) {
        assert.ok(allowedNextStatuses(order).includes(next), `can move to ${next}`);
        assert.equal(recordFulfilmentStatus(order, next, "admin"), true);
    }
    assert.deepEqual(
        order.statusHistory.map(entry => [entry.kind, entry.from, entry.to, entry.actor]),
        [
            ["fulfilment", "Order Placed", "Processing", "admin"],
            ["fulfilment", "Processing", "Packing", "admin"],
            ["fulfilment", "Packing", "Packed", "admin"],
            ["fulfilment", "Packed", "Shipped", "admin"],
            ["fulfilment", "Shipped", "Out for delivery", "admin"],
            ["fulfilment", "Out for delivery", "Delivered", "admin"]
        ]
    );
    assert.ok(order.statusHistory.every(entry => entry.at instanceof Date));
});

test("no skipping: Packing cannot jump to Shipped and Shipped cannot jump to Delivered", () => {
    assert.equal(isValidFulfillmentTransition("Packing", "Shipped"), false);
    assert.equal(isValidFulfillmentTransition("Shipped", "Delivered"), false);
    assert.equal(isValidFulfillmentTransition("Packed", "Delivered"), false);
});

test("cancellation is only legal before dispatch", () => {
    for (const status of ["Order Placed", "Processing", "Packing", "Packed"]) {
        assert.equal(isValidFulfillmentTransition(status, "Cancelled"), true, status);
    }
    for (const status of ["Shipped", "Out for delivery", "Delivered", "Return Requested", "Return Approved"]) {
        assert.equal(isValidFulfillmentTransition(status, "Cancelled"), false, status);
    }
});

test("return flow is Delivered -> Return Requested -> Return Approved, and terminal states stay terminal", () => {
    assert.equal(isValidFulfillmentTransition("Delivered", "Return Requested"), true);
    assert.equal(isValidFulfillmentTransition("Return Requested", "Return Approved"), true);
    assert.equal(isValidFulfillmentTransition("Return Requested", "Delivered"), true);
    assert.equal(isValidFulfillmentTransition("Packed", "Return Requested"), false);
    for (const terminal of ["Return Approved", "Cancelled"]) {
        for (const to of FULFILLMENT_STATUSES.filter(status => status !== terminal)) {
            assert.equal(isValidFulfillmentTransition(terminal, to), false, `${terminal} -> ${to}`);
        }
    }
});

test("Shipped is only offered once courier and tracking details exist", () => {
    assert.equal(allowedNextStatuses(makeOrder({ status: "Packed", shipping: {} })).includes("Shipped"), false);
    assert.equal(allowedNextStatuses(makeOrder({ status: "Packed" })).includes("Shipped"), true);
});

test("prepaid orders cannot be fulfilled before verified payment or while on hold", () => {
    const physical = ["Processing", "Packing", "Packed"];
    for (const paymentStatus of ["pending", "failed", "cancelled"]) {
        const next = allowedNextStatuses(makeOrder({ paymentMethod: "Razorpay", paymentStatus }));
        for (const status of physical) assert.equal(next.includes(status), false, `${paymentStatus}:${status}`);
        assert.equal(next.includes("Cancelled"), true);
    }
    const held = allowedNextStatuses(makeOrder({ paymentMethod: "Razorpay", paymentStatus: "paid", fulfillmentHold: true }));
    assert.equal(held.includes("Processing"), false);
    const paid = allowedNextStatuses(makeOrder({ paymentMethod: "Razorpay", paymentStatus: "paid" }));
    assert.equal(paid.includes("Processing"), true);
});

test("COD collection is only possible after delivery and is recorded with the admin actor", () => {
    for (const status of ["Order Placed", "Processing", "Packed", "Shipped", "Out for delivery", "Cancelled"]) {
        const order = makeOrder({ status });
        assert.ok(markCodCollected(order, "admin").error, status);
        assert.equal(order.paymentStatus, "cod_pending");
        assert.equal(order.statusHistory.length, 0);
    }
    const delivered = makeOrder({ status: "Delivered" });
    assert.deepEqual(markCodCollected(delivered, "admin"), { applied: true });
    assert.equal(delivered.paymentStatus, "paid");
    assert.deepEqual(
        delivered.statusHistory.map(entry => [entry.kind, entry.from, entry.to, entry.actor]),
        [["payment", "cod_pending", "paid", "admin"]]
    );
    assert.ok(markCodCollected(delivered, "admin").error, "cannot collect twice");
    assert.equal(delivered.statusHistory.length, 1);
});

test("history records only real changes, and payment never alters fulfilment status", () => {
    const order = makeOrder();
    assert.equal(recordFulfilmentStatus(order, "Order Placed", "admin"), false);
    assert.equal(recordPaymentStatus(order, "cod_pending"), false);
    assert.equal(order.statusHistory.length, 0);
    recordPaymentStatus(order, "paid", "system");
    assert.equal(order.status, "Order Placed");
    assert.equal(order.statusHistory[0].actor, "system");
});
