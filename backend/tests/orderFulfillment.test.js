import test from "node:test";
import assert from "node:assert/strict";
import {
    hasDispatchDetails,
    isEligibleForPrepaidFulfillment,
    isValidFulfillmentTransition,
    normalizeShippingDetails
} from "../utils/orderFulfillment.js";

test("allows only forward fulfilment transitions and idempotent repeats", () => {
    assert.equal(isValidFulfillmentTransition("Order Placed", "Processing"), true);
    assert.equal(isValidFulfillmentTransition("Order Placed", "Cancelled"), true);
    assert.equal(isValidFulfillmentTransition("Packed", "Shipped"), true);
    assert.equal(isValidFulfillmentTransition("Shipped", "Delivered"), false);
    assert.equal(isValidFulfillmentTransition("Delivered", "Packed"), false);
    assert.equal(isValidFulfillmentTransition("Cancelled", "Processing"), false);
    assert.equal(isValidFulfillmentTransition("Packed", "Packed"), true);
});

test("accepts factual courier/tracking details and validates supplied tracking URLs", () => {
    const parsed = normalizeShippingDetails({
        courierName: "  Courier Example ",
        trackingNumber: " AWB-123 ",
        trackingUrl: "https://tracking.example/awb/123",
        notes: "Packed"
    });

    test("holds unpaid or review-flagged prepaid orders from fulfilment", () => {
        assert.equal(isEligibleForPrepaidFulfillment({
            paymentMethod: "COD",
            paymentStatus: "cod_pending"
        }), true);
        assert.equal(isEligibleForPrepaidFulfillment({
            paymentMethod: "Razorpay",
            paymentStatus: "pending"
        }), false);
        assert.equal(isEligibleForPrepaidFulfillment({
            paymentMethod: "Razorpay",
            paymentStatus: "paid",
            fulfillmentHold: true
        }), false);
        assert.equal(isEligibleForPrepaidFulfillment({
            paymentMethod: "Razorpay",
            paymentStatus: "paid",
            fulfillmentHold: false
        }), true);
    });
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.shipping.courierName, "Courier Example");
    assert.equal(hasDispatchDetails(parsed.shipping), true);

    assert.match(normalizeShippingDetails({
        trackingUrl: "javascript:alert(1)"
    }).error, /HTTPS/);
    assert.match(normalizeShippingDetails({
        courierName: "Courier",
        unsupported: "value"
    }).error, /unsupported field/);
    assert.equal(hasDispatchDetails({ courierName: "Courier" }), false);
});
