import test from "node:test";
import assert from "node:assert/strict";
import productModel from "../models/productModel.js";
import { parseProductPayload } from "../utils/catalogueValidation.js";
import { parseCatalogueQuery } from "../utils/catalogueQuery.js";
import { ADMIN_PRODUCT_TYPES, parseAdminCatalogueQuery } from "../utils/adminCatalogueQuery.js";
import {
    CANONICAL_CATEGORIES,
    CATEGORY_MAPPING_STATUS,
    PRODUCT_TYPES,
    categoryForProductType,
    normalizeCategoryLabel
} from "../config/catalogueTaxonomy.js";

test("exactly four canonical categories with the approved labels, slugs, statuses and order", () => {
    assert.deepEqual(CANONICAL_CATEGORIES.map(({ id, label, slug, status }) => ({ id, label, slug, status })), [
        { id: "sarees", label: "Sarees", slug: "sarees", status: "available" },
        { id: "suit-pieces", label: "Suit Pieces", slug: "suit-pieces", status: "coming-soon" },
        { id: "lehengas", label: "Lehengas", slug: "lehengas", status: "coming-soon" },
        { id: "kurtis", label: "Kurtis", slug: "kurtis", status: "coming-soon" }
    ]);
    assert.ok(Object.isFrozen(CANONICAL_CATEGORIES));
    assert.ok(CANONICAL_CATEGORIES.every(category => Object.isFrozen(category)));
    assert.equal(CANONICAL_CATEGORIES.some(category => /pant/i.test(category.id + category.label + category.slug)), false,
        "Suit Pants is not a top-level category");
});

test("product types: legacy values stay and kurti is added, in one shared list", () => {
    for (const type of ["saree", "suit-piece", "suit", "suit-set", "dress", "lehenga", "other", "kurti"]) {
        assert.ok(PRODUCT_TYPES.includes(type), type);
    }
    assert.equal(new Set(PRODUCT_TYPES).size, PRODUCT_TYPES.length);
    assert.deepEqual(productModel.schema.path("productType").enumValues, [...PRODUCT_TYPES]);
    assert.deepEqual([...ADMIN_PRODUCT_TYPES], [...PRODUCT_TYPES]);
});

test("product type to canonical category mapping", () => {
    const expected = {
        saree: "sarees", "suit-piece": "suit-pieces", suit: "suit-pieces", "suit-set": "suit-pieces",
        lehenga: "lehengas", kurti: "kurtis"
    };
    for (const [type, id] of Object.entries(expected)) {
        const result = categoryForProductType(type);
        assert.equal(result.status, CATEGORY_MAPPING_STATUS.MAPPED, type);
        assert.equal(result.category.id, id, type);
    }
});

test("other stays unclassified and dress stays unresolved; neither is given a category", () => {
    assert.deepEqual(categoryForProductType("other"), { status: "unclassified", category: null });
    assert.deepEqual(categoryForProductType("dress"), { status: "unresolved", category: null });
    assert.deepEqual(categoryForProductType("bogus"), { status: "unresolved", category: null });
    assert.deepEqual(categoryForProductType("__proto__"), { status: "unresolved", category: null });
});

test("legacy labels map case-insensitively and ignore extra whitespace", () => {
    for (const raw of ["Sarees", "sarees", "  SAREE ", "sAreEs"]) {
        assert.equal(normalizeCategoryLabel(raw).category.id, "sarees", raw);
    }
    assert.equal(normalizeCategoryLabel("  Suit    Piece  ").category.id, "suit-pieces");
    assert.equal(normalizeCategoryLabel("SUIT PIECES").category.id, "suit-pieces");
    assert.equal(normalizeCategoryLabel("Lehenga").category.id, "lehengas");
    assert.equal(normalizeCategoryLabel("lehengas").category.id, "lehengas");
    assert.equal(normalizeCategoryLabel("Kurti").category.id, "kurtis");
    assert.equal(normalizeCategoryLabel("KURTIS").category.id, "kurtis");
});

test("Suit Pants, Silk Sarees and Cotton Sarees keep their subcategory under the parent category", () => {
    const pants = normalizeCategoryLabel("suit  pants");
    assert.equal(pants.category.id, "suit-pieces");
    assert.equal(pants.subCategory, "Suit Pants");
    const silk = normalizeCategoryLabel("Silk Sarees");
    assert.deepEqual([silk.category.id, silk.subCategory], ["sarees", "Silk Sarees"]);
    const cotton = normalizeCategoryLabel("cotton sarees");
    assert.deepEqual([cotton.category.id, cotton.subCategory], ["sarees", "Cotton Sarees"]);
    assert.equal(normalizeCategoryLabel("Sarees").subCategory, null);
});

test("unknown labels are unmapped and the raw input is always preserved", () => {
    for (const raw of ["Lungis", "", "   ", "Dupatta", "Sarees!", undefined, null, 42, "__proto__", "constructor"]) {
        const result = normalizeCategoryLabel(raw);
        assert.equal(result.mapped, false, String(raw));
        assert.equal(result.category, null);
        assert.equal(result.subCategory, null);
        assert.equal(result.raw, raw);
    }
    assert.equal(normalizeCategoryLabel("  Suit  Pants ").raw, "  Suit  Pants ", "raw is not trimmed or altered");
});

const payload = (productType, extra = {}) => ({
    name: "Test product", description: "A test product.", productType, category: "Test",
    pricePaise: 100000, status: "draft",
    variants: [{ sku: `SKU-${productType}`, stockOnHand: 3, active: true }],
    ...extra
});

test("payload validation accepts kurti and every existing product type", () => {
    for (const type of PRODUCT_TYPES) {
        assert.equal(parseProductPayload(payload(type)).productType, type, type);
    }
    assert.equal(parseProductPayload(payload("kurti", { category: "Kurtis" })).productType, "kurti");
});

test("payload validation still rejects unsupported types and keeps legacy 'other' editable", () => {
    for (const bad of ["kurtis", "Kurti", "suit-pants", "", "sarees"]) {
        assert.throws(() => parseProductPayload(payload(bad)), { status: 400, message: "Unsupported product type." }, bad);
    }
    assert.equal(parseProductPayload(payload("other", { category: "Legacy" })).productType, "other");
});

test("public and admin catalogue queries accept kurti and still reject unknown types", () => {
    assert.equal(parseCatalogueQuery({ productType: "kurti" }).filter.productType, "kurti");
    assert.equal(parseAdminCatalogueQuery({ productType: "kurti" }).productType, "kurti");
    assert.throws(() => parseCatalogueQuery({ productType: "kurtis" }), { status: 400 });
    assert.throws(() => parseAdminCatalogueQuery({ productType: "kurtis" }), { status: 400 });
});

test("Mongoose product schema accepts kurti and rejects an unknown type", async () => {
    const base = {
        name: "K", slug: "k", description: "d", category: "Kurtis", pricePaise: 1000,
        images: [{ url: "https://example.test/a.jpg" }]
    };
    assert.equal(await new productModel({ ...base, productType: "kurti" }).validate(), undefined);
    await assert.rejects(new productModel({ ...base, productType: "kurtis" }).validate(), { name: "ValidationError" });
});
