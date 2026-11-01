import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    buildStockAdjustment,
    parseStockAdjustment,
    toStockSummary,
    MAX_STOCK_ADJUSTMENT,
    MAX_STOCK_ON_HAND
} from "../utils/stockAdjustment.js";
import { assertStatusTransition, resolveStatusForEdit } from "../utils/productStatus.js";
import { planVariantChanges } from "../utils/variantPlan.js";
import { buildProductUpdate } from "../utils/productUpdate.js";
import { parseProductPayload, validatePublishableProduct } from "../utils/catalogueValidation.js";

const rejects = (fn, pattern) => assert.throws(fn, error => error.status === 400 && pattern.test(error.message));

test("stock adjustment: accepts receive and correction", () => {
    assert.deepEqual(parseStockAdjustment({ operation: "receive", quantity: 10 }),
        { operation: "receive", delta: 10, reason: "" });
    assert.deepEqual(parseStockAdjustment({ operation: "correction", quantity: -2, reason: " Damaged piece " }),
        { operation: "correction", delta: -2, reason: "Damaged piece" });
});

test("stock adjustment: rejects malformed input", () => {
    for (const body of [undefined, null, [], "x", {}, { operation: "set", quantity: 1 }]) {
        assert.throws(() => parseStockAdjustment(body), { status: 400 });
    }
    for (const quantity of [0, 1.5, "5", NaN, Infinity, null, undefined, MAX_STOCK_ADJUSTMENT + 1, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => parseStockAdjustment({ operation: "receive", quantity }), { status: 400 }, String(quantity));
    }
    rejects(() => parseStockAdjustment({ operation: "receive", quantity: -1 }), /positive/);
    rejects(() => parseStockAdjustment({ operation: "correction", quantity: -1 }), /reason/);
    rejects(() => parseStockAdjustment({ operation: "correction", quantity: -1, reason: "ab" }), /reason/);
    rejects(() => parseStockAdjustment({ operation: "correction", quantity: 1, reason: "x".repeat(201) }), /200/);
    rejects(() => parseStockAdjustment({ operation: "receive", quantity: 1, reason: 5 }), /text/);
});

test("stock adjustment: builds one atomic guarded $inc that never touches reserved", () => {
    const { filter, update } = buildStockAdjustment("p1", "v1", -3);
    assert.deepEqual(update, { $inc: { stockOnHand: -3 } });
    assert.equal(filter._id, "v1");
    assert.equal(filter.productId, "p1");
    const [floor] = filter.$expr.$and;
    assert.deepEqual(floor.$gte[0], { $add: [{ $ifNull: ["$stockOnHand", 0] }, -3] });
    assert.deepEqual(floor.$gte[1], { $ifNull: ["$reserved", 0] });
});

// Applies the same filter semantics and $inc as MongoDB would, one atomic step at a time.
const applyAtomic = (doc, delta) => {
    if (doc.stockOnHand + delta < doc.reserved) return false;
    doc.stockOnHand += delta;
    return true;
};

test("stock adjustment: interleaved order decrements and receipts never overwrite each other", () => {
    const doc = { stockOnHand: 10, reserved: 2 };
    const staleFormValue = doc.stockOnHand;
    doc.stockOnHand -= 4; // an order sells 4 after the form loaded
    assert.equal(applyAtomic(doc, 5), true);
    assert.equal(doc.stockOnHand, 11); // 10 - 4 + 5, not staleFormValue + 5
    assert.notEqual(doc.stockOnHand, staleFormValue + 5);
});

test("stock adjustment: cannot go below reserved", () => {
    const doc = { stockOnHand: 5, reserved: 3 };
    assert.equal(applyAtomic(doc, -3), false);
    assert.equal(doc.stockOnHand, 5);
    assert.equal(applyAtomic(doc, -2), true);
    assert.equal(doc.stockOnHand, 3);
    assert.equal(doc.reserved, 3);
});

test("stock summary exposes on hand, reserved and available", () => {
    assert.deepEqual(toStockSummary({ _id: "a", sku: "S1", stockOnHand: 5, reserved: 2 }),
        { _id: "a", sku: "S1", active: true, stockOnHand: 5, reserved: 2, available: 3 });
    assert.equal(toStockSummary({ _id: "a", sku: "S1", stockOnHand: 1, reserved: 4 }).available, 0);
});

test("stock route is admin-protected and the edit path no longer writes stock", () => {
    const route = readFileSync(new URL("../routes/productRoute.js", import.meta.url), "utf8");
    assert.match(route, /patch\("\/:productId\/variants\/:variantId\/stock", adminAuth, adjustStock\)/);
    const plan = readFileSync(new URL("../utils/variantPlan.js", import.meta.url), "utf8");
    const updatesBlock = plan.slice(plan.indexOf("if (current)"), plan.indexOf("} else {"));
    assert.doesNotMatch(updatesBlock, /stockOnHand/);
});

test("status transitions", () => {
    assert.equal(resolveStatusForEdit("archived", undefined), "archived");
    assert.equal(resolveStatusForEdit("archived", "archived"), "archived");
    assert.equal(resolveStatusForEdit("archived", "draft"), "draft");
    assert.equal(resolveStatusForEdit("published", undefined), "published");
    assert.equal(resolveStatusForEdit("draft", "published"), "published");
    rejects(() => resolveStatusForEdit("archived", "published"), /Restore an archived product to Draft/);
    rejects(() => assertStatusTransition("draft", "deleted"), /status must be/);
    assert.doesNotThrow(() => assertStatusTransition("published", "archived"));
});

const base = { name: "Saree", description: "d", productType: "saree", category: "Silk", pricePaise: 1000 };
const baseProduct = { slug: "saree", bestseller: false, fastSelling: false };

test("MRP: set, clear and omit", () => {
    const run = mrpPaise => buildProductUpdate({
        payload: { ...base, mrpPaise }, product: baseProduct, images: [], status: "draft"
    });
    const set = run(2000);
    assert.equal(set.$set.mrpPaise, 2000);
    assert.equal(set.$unset, undefined);
    const cleared = run(null);
    assert.deepEqual(cleared.$unset, { mrpPaise: "" });
    assert.equal("mrpPaise" in cleared.$set, false);
    const omitted = run(undefined);
    assert.equal(omitted.$unset, undefined);
    assert.equal("mrpPaise" in omitted.$set, false);
});

const stored = (sku, extra = {}) => ({ _id: `id-${sku}`, sku, active: true, stockOnHand: 5, reserved: 1, ...extra });

test("variant override: set, clear and omit", () => {
    const existing = [stored("A1")];
    const plan = override => planVariantChanges(existing, [{ sku: "A1", stockOnHand: 5, priceOverridePaise: override }]).updates[0];
    assert.equal(plan(1500).set.priceOverridePaise, 1500);
    assert.deepEqual(plan(null).unset, { priceOverridePaise: "" });
    const omitted = plan(undefined);
    assert.equal("priceOverridePaise" in omitted.set, false);
    assert.deepEqual(omitted.unset, {});
});

test("payload validation accepts null MRP/override and archived status", () => {
    const raw = {
        ...base, mrpPaise: null, status: "archived", details: { blousePieceIncluded: true },
        variants: [{ sku: "A1", stockOnHand: 1, priceOverridePaise: null }]
    };
    const parsed = parseProductPayload(JSON.stringify(raw));
    assert.equal(parsed.mrpPaise, null);
    assert.equal(parsed.status, "archived");
    assert.throws(() => parseProductPayload(JSON.stringify({ ...raw, status: "deleted" })), { status: 400 });
});

test("variant plan: never deactivates omitted SKUs or writes stock for saved SKUs", () => {
    const existing = [stored("A1"), stored("B2")];
    const plan = planVariantChanges(existing, [{ sku: "a1", stockOnHand: 999, options: { Colour: "Red" } }]);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].set.active, undefined);
    assert.equal("stockOnHand" in plan.updates[0].set, false);
    assert.equal(plan.activeCount, 2);
});

test("variant plan: does not reactivate inactive SKUs when active is omitted", () => {
    const existing = [stored("A1", { active: false })];
    const plan = planVariantChanges(existing, [{ sku: "A1", stockOnHand: 5 }]);
    assert.equal("active" in plan.updates[0].set, false);
    assert.equal(plan.activeCount, 0);
    const reactivated = planVariantChanges(existing, [{ sku: "A1", stockOnHand: 5, active: true }]);
    assert.equal(reactivated.updates[0].set.active, true);
    assert.equal(reactivated.activeCount, 1);
});

test("variant plan: explicit deactivation is applied and counted; nothing is deleted", () => {
    const existing = [stored("A1"), stored("B2")];
    const plan = planVariantChanges(existing, [{ sku: "A1", stockOnHand: 5, active: false }]);
    assert.equal(plan.updates[0].set.active, false);
    assert.equal(plan.activeCount, 1);
    assert.equal(plan.creates.length, 0);
});

test("variant plan: saved SKU identity cannot be renamed; new SKUs are created with stock", () => {
    const existing = [stored("A1")];
    rejects(() => planVariantChanges(existing, [{ _id: "id-A1", sku: "Z9", stockOnHand: 5 }]), /cannot be changed/);
    const plan = planVariantChanges(existing, [
        { sku: "A1", stockOnHand: 5 },
        { sku: "n3", stockOnHand: 7, options: { Colour: "Blue" } }
    ]);
    assert.equal(plan.creates.length, 1);
    assert.equal(plan.creates[0].sku, "N3");
    assert.equal(plan.creates[0].stockOnHand, 7);
    assert.equal(plan.creates[0].lowStockThreshold, 2);
    assert.equal(plan.activeCount, 2);
});

test("stock filter scopes by product and variant and enforces both the reserved floor and the maximum", () => {
    const { filter } = buildStockAdjustment("p1", "v1", 5);
    assert.equal(filter._id, "v1");
    assert.equal(filter.productId, "p1");
    const [floor, ceiling] = filter.$expr.$and;
    assert.deepEqual(ceiling.$lte[1], MAX_STOCK_ON_HAND);
    assert.deepEqual(floor.$gte[0], ceiling.$lte[0]);
});

test("stock controller uses one findOneAndUpdate, scopes the miss lookup by product, and never touches reserved", () => {
    const controller = readFileSync(new URL("../controllers/productController.js", import.meta.url), "utf8");
    const body = controller.slice(controller.indexOf("const adjustStock"), controller.indexOf("export {"));
    assert.equal((body.match(/findOneAndUpdate\(/g) || []).length, 1);
    assert.match(body, /findOne\(\{ _id: variantId, productId \}\)/);
    assert.doesNotMatch(body, /reserved\s*:/);
    assert.match(body, /status\(409\)/);
});

test("simulated concurrent adjustments never leave stockOnHand below reserved", () => {
    const doc = { stockOnHand: 6, reserved: 4 };
    const deltas = [-1, -1, -1, 3, -4, -2, 2, -5];
    for (const delta of deltas) {
        applyAtomic(doc, delta);
        assert.ok(doc.stockOnHand >= doc.reserved);
    }
});

test("reason and operation edge cases are rejected", () => {
    rejects(() => parseStockAdjustment({ operation: "correction", quantity: 1, reason: "bad\u0000reason" }), /unsupported/);
    rejects(() => parseStockAdjustment({ operation: "correction", quantity: 1, reason: "   " }), /reason/);
    assert.equal(parseStockAdjustment({ operation: "receive", quantity: MAX_STOCK_ADJUSTMENT }).delta, MAX_STOCK_ADJUSTMENT);
});

test("publishing is rejected when no active variant would remain, and plan counts explicit deactivation", () => {
    const published = { ...base, status: "published", details: { blousePieceIncluded: true } };
    const images = [{ role: "primary" }];
    assert.throws(() => validatePublishableProduct({ ...published, variants: [] }, images), { status: 400 });
    assert.doesNotThrow(() => validatePublishableProduct({ ...published, variants: [{ active: true }] }, images));
    const existing = [stored("A1")];
    assert.equal(planVariantChanges(existing, [{ sku: "A1", stockOnHand: 5, active: false }]).activeCount, 0);
});

test("applyVariantPlan never deletes variants", () => {
    const controller = readFileSync(new URL("../controllers/productController.js", import.meta.url), "utf8");
    assert.doesNotMatch(controller, /productVariantModel\.(deleteOne|deleteMany|findOneAndDelete|findByIdAndDelete)/);
});
