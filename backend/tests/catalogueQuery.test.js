import test from "node:test";
import assert from "node:assert/strict";
import { parseCatalogueQuery } from "../utils/catalogueQuery.js";

test("builds published category and collection filters with default pagination", () => {
    const result = parseCatalogueQuery({
        productType: "saree",
        category: "Sarees",
        collection: "Diwali",
        search: "Silk (Banarasi)"
    });

    assert.deepEqual(result.filter, {
        status: "published",
        productType: "saree",
        category: "Sarees",
        collections: "Diwali",
        $or: [
            { name: { $regex: "Silk \\(Banarasi\\)", $options: "i" } },
            { category: { $regex: "Silk \\(Banarasi\\)", $options: "i" } },
            { "details.fabric": { $regex: "Silk \\(Banarasi\\)", $options: "i" } },
            { "details.colour": { $regex: "Silk \\(Banarasi\\)", $options: "i" } },
            { "details.occasion": { $regex: "Silk \\(Banarasi\\)", $options: "i" } }
        ]
    });
    assert.equal(result.page, 1);
    assert.equal(result.limit, 24);
    assert.equal(result.skip, 0);
    assert.deepEqual(result.sortBy, { createdAt: -1 });
});

test("supports price sorting and calculates pagination offsets", () => {
    const ascending = parseCatalogueQuery({ sort: "price-asc", page: "3", limit: "12" });
    assert.deepEqual(ascending.sortBy, { pricePaise: 1, createdAt: -1 });
    assert.equal(ascending.skip, 24);

    const descending = parseCatalogueQuery({ sort: "price-desc" });
    assert.deepEqual(descending.sortBy, { pricePaise: -1, createdAt: -1 });
});

test("builds fabric, colour, occasion, price, and availability filters", () => {
    const result = parseCatalogueQuery({
        fabric: "Pure Silk",
        colour: "Deep Red",
        occasion: "Wedding",
        minPrice: "1250.50",
        maxPrice: "5000",
        availableOnly: "true"
    });

    assert.deepEqual(result.filter["details.fabric"], { $regex: "^Pure Silk$", $options: "i" });
    assert.deepEqual(result.filter["details.colour"], { $regex: "^Deep Red$", $options: "i" });
    assert.deepEqual(result.filter["details.occasion"], { $regex: "^Wedding$", $options: "i" });
    assert.equal(result.minPricePaise, 125050);
    assert.equal(result.maxPricePaise, 500000);
    assert.equal(result.availableOnly, true);
});

test("searches product name, category, fabric, colour, and occasion safely", () => {
    const result = parseCatalogueQuery({ search: "silk.*" });

    assert.deepEqual(result.filter.$or, [
        { name: { $regex: "silk\\.\\*", $options: "i" } },
        { category: { $regex: "silk\\.\\*", $options: "i" } },
        { "details.fabric": { $regex: "silk\\.\\*", $options: "i" } },
        { "details.colour": { $regex: "silk\\.\\*", $options: "i" } },
        { "details.occasion": { $regex: "silk\\.\\*", $options: "i" } }
    ]);
});

test("rejects malformed or contradictory catalogue price filters", () => {
    assert.throws(() => parseCatalogueQuery({ minPrice: "-1" }), /non-negative amount/);
    assert.throws(() => parseCatalogueQuery({ maxPrice: "10.999" }), /two decimal places/);
    assert.throws(() => parseCatalogueQuery({ minPrice: "20", maxPrice: "10" }), /cannot be greater/);
    assert.throws(() => parseCatalogueQuery({ availableOnly: "yes" }), /true or false/);
});

test("rejects unsupported filters, sort values, and invalid pagination", () => {
    assert.throws(() => parseCatalogueQuery({ productType: "clothing" }), /Invalid product type/);
    assert.throws(() => parseCatalogueQuery({ sort: "random" }), /Sort must be/);
    assert.throws(() => parseCatalogueQuery({ page: "0" }), /positive whole number/);
    assert.throws(() => parseCatalogueQuery({ limit: "61" }), /cannot exceed 60/);
    assert.throws(() => parseCatalogueQuery({ category: " " }), /non-empty value/);
    assert.throws(() => parseCatalogueQuery({ search: " " }), /non-empty value/);
});

test("accepts the new suit, suit-set, and dress catalogue filters", () => {
    for (const productType of ["suit", "suit-set", "dress"]) {
        assert.equal(parseCatalogueQuery({ productType }).filter.productType, productType);
    }
});
