import test from "node:test";
import assert from "node:assert/strict";
import {
    calculateSubtotalPaise,
    calculateShippingPaise,
    normalizeDeliveryAddress,
    validateDeliveryAddress
} from "../utils/orderValidation.js";
import { paymentUnavailable } from "../controllers/orderController.js";

const validAddress = () => ({
    firstName: "Asha",
    lastName: "Kumari",
    email: "asha@example.com",
    street: "1 Market Road",
    city: "Begusarai",
    state: "Bihar",
    zipcode: "851101",
    country: "India",
    phone: "9876543210"
});

test("calculates subtotals exactly in paise", () => {
    assert.equal(calculateSubtotalPaise([
        { unitPricePaise: 12550, quantity: 2 },
        { unitPricePaise: 999, quantity: 1 }
    ]), 26099);
});

test("keeps the existing shipping charge by default and supports an explicitly configured threshold", () => {
    assert.equal(calculateShippingPaise(12500), 5000);
    assert.equal(calculateShippingPaise(12500, { feePaise: 7500 }), 7500);
    assert.equal(calculateShippingPaise(50000, {
        feePaise: 5000,
        freeShippingThresholdPaise: 50000
    }), 0);
    assert.equal(calculateShippingPaise(49999, {
        feePaise: 5000,
        freeShippingThresholdPaise: 50000
    }), 5000);
});

test("rejects unsafe or invalid quantities and totals", () => {
    assert.throws(() => calculateSubtotalPaise([
        { unitPricePaise: 100, quantity: 0 }
    ]), /positive whole quantities/);
    assert.throws(() => calculateSubtotalPaise([
        { unitPricePaise: Number.MAX_SAFE_INTEGER, quantity: 2 }
    ]), /exceeds the supported amount/);
});

test("validates Indian delivery address fields", () => {
    assert.equal(validateDeliveryAddress(validAddress()), null);
    assert.match(validateDeliveryAddress({ ...validAddress(), zipcode: "123" }), /six-digit/);
    assert.match(validateDeliveryAddress({ ...validAddress(), country: "United States" }), /only within India/);
    assert.equal(normalizeDeliveryAddress({ ...validAddress(), email: " ASHA@EXAMPLE.COM " }).email, "asha@example.com");
});

test("online payment endpoints remain explicitly unavailable", () => {
    let status;
    let body;
    const response = {
        status(code) {
            status = code;
            return this;
        },
        json(value) {
            body = value;
            return this;
        }
    };
    paymentUnavailable({}, response);
    assert.equal(status, 503);
    assert.equal(body.success, false);
    assert.match(body.message, /No payment has been taken/);
});
