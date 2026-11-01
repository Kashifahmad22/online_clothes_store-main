import test from "node:test";
import assert from "node:assert/strict";
import productRouter from "../routes/productRoute.js";
import adminAuth from "../middleware/adminAuth.js";
import productModel from "../models/productModel.js";
import { isLowStock, resolveBadgeFlags, DEFAULT_LOW_STOCK_THRESHOLD } from "../utils/merchandising.js";
import { parseProductPayload, toPublicProduct } from "../utils/catalogueValidation.js";

const variant = (stockOnHand, extra = {}) => ({ stockOnHand, reserved: 0, active: true, ...extra });

test("the default low-stock threshold is the existing per-SKU default of 2", () => {
    assert.equal(DEFAULT_LOW_STOCK_THRESHOLD, 2);
    assert.equal(productModel.schema.path("bestseller").defaultValue, false);
});

test("low stock: positive stock below the threshold", () => {
    assert.equal(isLowStock([variant(1)]), true);
    assert.equal(isLowStock([variant(4, { reserved: 3 })]), true);
    assert.equal(isLowStock([variant(2, { lowStockThreshold: 5 })]), true);
});

test("low stock: equal to or above the threshold is not low", () => {
    assert.equal(isLowStock([variant(2)]), false);
    assert.equal(isLowStock([variant(10)]), false);
    assert.equal(isLowStock([variant(5, { lowStockThreshold: 5 })]), false);
});

test("low stock: zero, fully reserved and inactive stock never show the badge", () => {
    assert.equal(isLowStock([variant(0)]), false);
    assert.equal(isLowStock([variant(3, { reserved: 3 })]), false);
    assert.equal(isLowStock([variant(1, { active: false })]), false);
    assert.equal(isLowStock([]), false);
});

test("low stock: missing or malformed stock data is treated as unreliable", () => {
    assert.equal(isLowStock(undefined), false);
    assert.equal(isLowStock([{ active: true }]), false);
    assert.equal(isLowStock([variant("1")]), false);
    assert.equal(isLowStock([variant(-1)]), false);
    assert.equal(isLowStock([variant(1.5)]), false);
    assert.equal(isLowStock([variant(1, { reserved: "x" })]), false);
});

test("low stock: variants are aggregated, so one low size of a well-stocked product is not flagged", () => {
    assert.equal(isLowStock([variant(1), variant(20)]), false);
    assert.equal(isLowStock([variant(1), variant(0)]), true);
});

const base = () => ({ pricePaise: 100000, images: [], toObject() { return { ...this, toObject: undefined }; } });

test("public product exposes only boolean merchandising flags with safe defaults for older products", () => {
    const legacy = toPublicProduct({ pricePaise: 100000, images: [] }, [variant(10)]);
    assert.equal(legacy.bestseller, false);
    assert.equal(legacy.fastSelling, false);
    assert.equal(legacy.lowStock, false);

    const flagged = toPublicProduct({ pricePaise: 100000, images: [], fastSelling: true }, [variant(1)]);
    assert.equal(flagged.fastSelling, true);
    assert.equal(flagged.lowStock, true);
    assert.equal(toPublicProduct(base(), [variant(0)]).lowStock, false);
});

test("badge flags are saved only when explicitly set and stay mutually exclusive", () => {
    assert.deepEqual(resolveBadgeFlags({}), { bestseller: false, fastSelling: false });
    assert.deepEqual(resolveBadgeFlags({ fastSelling: true }), { bestseller: false, fastSelling: true });
    assert.deepEqual(resolveBadgeFlags({ bestseller: true }), { bestseller: true, fastSelling: false });
    assert.deepEqual(resolveBadgeFlags({ bestseller: false, fastSelling: false }, { bestseller: true }),
        { bestseller: false, fastSelling: false });
});

test("an older payload that omits the badge fields preserves the stored badge", () => {
    assert.deepEqual(resolveBadgeFlags({}, { fastSelling: true }), { bestseller: false, fastSelling: true });
    assert.deepEqual(resolveBadgeFlags({}, { bestseller: true }), { bestseller: true, fastSelling: false });
    assert.deepEqual(resolveBadgeFlags({ bestseller: true }, { fastSelling: true }),
        { bestseller: true, fastSelling: false });
});

test("badge fields must be strict booleans and cannot both be enabled", () => {
    const payload = extra => JSON.stringify({
        name: "A", description: "B", productType: "saree", category: "Sarees", pricePaise: 1000, ...extra
    });
    assert.throws(() => parseProductPayload(payload({ fastSelling: "yes" })), /Fast selling/);
    assert.throws(() => parseProductPayload(payload({ bestseller: 1 })), /Bestseller/);
    assert.throws(() => parseProductPayload(payload({ bestseller: true, fastSelling: true })), /not both/);
});

test("changing a badge requires admin authentication", () => {
    const protectedRoutes = productRouter.stack
        .filter(layer => layer.route && ["post", "put", "patch"].some(method => layer.route.methods[method]))
        .map(layer => layer.route.stack[0].handle);
    assert.ok(protectedRoutes.length >= 3);
    for (const handle of protectedRoutes) assert.equal(handle, adminAuth);
});
