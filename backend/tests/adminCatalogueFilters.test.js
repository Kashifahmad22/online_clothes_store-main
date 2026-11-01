import test from "node:test";
import assert from "node:assert/strict";
import productRouter from "../routes/productRoute.js";
import adminAuth from "../middleware/adminAuth.js";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import { listAdminCategories, listAdminProducts } from "../controllers/productController.js";
import {
    buildAdminPricePipeline,
    buildAdminProductFilter,
    escapeRegex,
    filterIdsByStockState,
    parseAdminCatalogueQuery,
    searchPattern
} from "../utils/adminCatalogueQuery.js";
import { availableUnits, isLowStock, stockState, startingPricePaise } from "../utils/merchandising.js";

// Pure utilities are tested directly. Controller tests stub the Mongoose models, so they verify query
// construction and response shaping, not real MongoDB matching, sorting or collation behaviour.

const v = (stockOnHand, reserved = 0, extra = {}) => ({ stockOnHand, reserved, lowStockThreshold: 2, active: true, ...extra });

test("stock state: available is on hand minus reserved over active variants only", () => {
    assert.equal(availableUnits([v(10, 4)]), 6);
    assert.equal(availableUnits([v(10, 4), v(5, 5)]), 6);
    assert.equal(availableUnits([v(3, 9)]), 0, "never negative");
    assert.equal(availableUnits([v(10), v(50, 0, { active: false })]), 10, "inactive variants excluded");
    assert.equal(availableUnits([]), 0);
    assert.equal(availableUnits([v(NaN)]), 0);
    assert.equal(availableUnits([v(5, undefined)]), 5);
});

test("stock state classification: out, low and in stock", () => {
    assert.equal(stockState([]), "out-of-stock", "no active variants means nothing available");
    assert.equal(stockState([v(0)]), "out-of-stock");
    assert.equal(stockState([v(5, 5)]), "out-of-stock", "fully reserved is unavailable");
    assert.equal(stockState([v(50, 0, { active: false })]), "out-of-stock", "inactive stock does not count");
    assert.equal(stockState([v(1)]), "low-stock");
    assert.equal(stockState([v(6, 5)]), "low-stock", "reserved units reduce availability");
    assert.equal(stockState([v(2)]), "in-stock", "available equal to the threshold is not low");
    assert.equal(stockState([v(20)]), "in-stock");
});

test("stock state reuses isLowStock: low-stock exactly when the storefront rule says so and stock remains", () => {
    const samples = [
        [v(1)], [v(0)], [v(2)], [v(3)], [v(1), v(1)], [v(9, 8)], [v(1, 0, { lowStockThreshold: 5 })],
        [v(1), v(40, 0, { active: false })], [v(NaN)], [v(5, 0, { lowStockThreshold: 0 })], []
    ];
    for (const variants of samples) {
        const low = isLowStock(variants);
        assert.equal(stockState(variants) === "low-stock", low, JSON.stringify(variants));
        if (low) assert.ok(availableUnits(variants) > 0, "a low-stock product always has stock");
    }
});

test("each product falls into exactly one stock state", () => {
    const samples = [[], [v(0)], [v(1)], [v(8)], [v(8), v(0, 0, { active: false })]];
    for (const variants of samples) {
        const states = ["in-stock", "low-stock", "out-of-stock"].filter(s => stockState(variants) === s);
        assert.equal(states.length, 1);
    }
});

test("filterIdsByStockState keeps products whose active variants match, including products with no variants", () => {
    const ids = ["a", "b", "c", "d"];
    const variants = [
        { productId: "a", ...v(20) },
        { productId: "b", ...v(1) },
        { productId: "c", ...v(4, 4) }
    ];
    assert.deepEqual(filterIdsByStockState(ids, variants, "in-stock", stockState), ["a"]);
    assert.deepEqual(filterIdsByStockState(ids, variants, "low-stock", stockState), ["b"]);
    assert.deepEqual(filterIdsByStockState(ids, variants, "out-of-stock", stockState), ["c", "d"]);
});

test("query parsing: valid filters, trimming, and every supported sort", () => {
    const parsed = parseAdminCatalogueQuery({
        search: "  Silk  ", status: "published", category: " Sarees ", productType: "saree",
        stock: "low-stock", badge: "bestseller", sort: "price-asc", page: "2"
    });
    assert.deepEqual(
        [parsed.search, parsed.status, parsed.category, parsed.productType, parsed.stock, parsed.badge, parsed.page],
        ["Silk", "published", "Sarees", "saree", "low-stock", "bestseller", 2]
    );
    for (const sort of ["updatedAt-desc", "createdAt-desc", "name-asc", "price-asc", "price-desc"]) {
        const keys = Object.keys(parseAdminCatalogueQuery({ sort }).sort);
        assert.equal(keys.at(-1), "_id", sort);
    }
    assert.ok(parseAdminCatalogueQuery({ sort: "name-asc" }).collation);
    assert.equal(parseAdminCatalogueQuery({ sort: "price-asc" }).collation, undefined);
    assert.equal(parseAdminCatalogueQuery({ search: "   " }).search, undefined, "blank search is ignored");
});

test("query parsing rejects invalid filters, operators and oversized search", () => {
    const bad = [
        { status: "deleted" }, { status: "Published" }, { status: ["draft", "draft"] }, { status: { $ne: "draft" } },
        { productType: "shirt" }, { productType: "saree,suit" },
        { stock: "plenty" }, { stock: "in_stock" },
        { badge: "sale" }, { badge: "" },
        { sort: "stock-asc" }, { sort: "name-desc" },
        { category: { $ne: "Sarees" } }, { category: ["a", "b"] }, { category: "x".repeat(101) },
        { search: "x".repeat(81) }, { search: { $regex: ".*" } }, { search: ["a"] }, { search: "bad\u0000value" },
        { "search[$gt]": "" }
    ];
    for (const query of bad) assert.throws(() => parseAdminCatalogueQuery(query), { status: 400 }, JSON.stringify(query));
    assert.equal(parseAdminCatalogueQuery({ search: "x".repeat(80) }).search.length, 80);
});

test("search escapes regular expression characters", () => {
    assert.equal(escapeRegex("a.b*c(d)[e]"), "a\\.b\\*c\\(d\\)\\[e\\]");
    const pattern = searchPattern(".*");
    assert.equal(pattern.test("Silk Saree"), false, "a wildcard must not match everything");
    assert.equal(pattern.test("weird .* name"), true);
    assert.equal(searchPattern("silk").test("Banarasi SILK"), true);
    assert.doesNotThrow(() => searchPattern("(((["));
    assert.equal(searchPattern("(a|b)").test("a"), false);
});

test("filters combine with AND and never carry client-supplied operators", () => {
    const filter = buildAdminProductFilter(parseAdminCatalogueQuery({
        status: "published", category: "Sarees", productType: "saree", badge: "bestseller"
    }));
    assert.deepEqual(filter, { status: "published", category: "Sarees", productType: "saree", bestseller: true });
    assert.deepEqual(buildAdminProductFilter(parseAdminCatalogueQuery({ badge: "fastSelling" })), { fastSelling: true });
    assert.deepEqual(buildAdminProductFilter(parseAdminCatalogueQuery({ badge: "none" })),
        { bestseller: { $ne: true }, fastSelling: { $ne: true } });
    assert.deepEqual(buildAdminProductFilter(parseAdminCatalogueQuery({})), {});
});

test("search matches name, category, type and SKU-matched product ids in one OR, ANDed with filters", () => {
    const ids = ["id1", "id2"];
    const filter = buildAdminProductFilter(parseAdminCatalogueQuery({ search: "silk", status: "draft" }), ids);
    assert.equal(filter.status, "draft");
    assert.equal(filter.$or.length, 4);
    const fields = filter.$or.map(clause => Object.keys(clause)[0]);
    assert.deepEqual(fields, ["name", "category", "productType", "_id"]);
    assert.deepEqual(filter.$or[3]._id.$in, ids);
    assert.ok(filter.$or[0].name instanceof RegExp);
});

// ---- controller behaviour with stubbed models ----

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.body = body; return res; };
    return res;
};

const withStubs = async (stubs, run) => {
    const originals = stubs.map(([target, key]) => [target, key, target[key]]);
    for (const [target, key, value] of stubs) target[key] = value;
    try { await run(); } finally { for (const [target, key, value] of originals) target[key] = value; }
};

const oid = n => String(n).padStart(24, "0");
const product = (n, extra = {}) => ({
    _id: oid(n), name: `Product ${n}`, status: "published", pricePaise: 100000, category: "Sarees", productType: "saree",
    toObject() { return { ...this }; }, ...extra
});

const harness = ({ products = [], total = products.length, variantsByCall = {}, activeVariants = [], skuIds = [], orderedIds = null } = {}) => {
    const calls = { find: [], collation: [], variantFind: [], distinct: [], count: [], aggregate: [] };
    const stubs = [
        [productModel, "aggregate", async pipeline => {
            calls.aggregate.push(pipeline);
            return (orderedIds || products.map(item => item._id)).map(_id => ({ _id }));
        }],
        [productModel, "countDocuments", async filter => { calls.count.push(filter); return total; }],
        [productModel, "find", filter => {
            calls.find.push(filter);
            const chain = {
                select() { return chain; },
                lean() { return Promise.resolve(products); },
                sort(value) { calls.sort = value; return chain; },
                collation(value) { calls.collation.push(value); return chain; },
                skip(value) { calls.skip = value; return chain; },
                limit(value) { calls.limit = value; return chain; },
                then(resolve, reject) { return Promise.resolve(products).then(resolve, reject); }
            };
            return chain;
        }],
        [productVariantModel, "distinct", async (field, filter) => { calls.distinct.push([field, filter]); return skuIds; }],
        [productVariantModel, "find", filter => {
            calls.variantFind.push(filter);
            const chain = {
                select() { return chain; },
                lean() { return Promise.resolve(activeVariants); },
                sort() { return Promise.resolve(variantsByCall.page || []); }
            };
            return chain;
        }]
    ];
    return { calls, stubs };
};

test("listAdminProducts applies status, category, type and badge filters to both the page and the total", async () => {
    const { calls, stubs } = harness({ products: [product(1)], total: 1 });
    await withStubs(stubs, async () => {
        const res = response();
        await listAdminProducts({ query: {
            status: "published", category: "Sarees", productType: "saree", badge: "bestseller"
        } }, res);
        assert.equal(res.statusCode, 200);
        const expected = { status: "published", category: "Sarees", productType: "saree", bestseller: true };
        assert.deepEqual(calls.find[0], expected);
        assert.deepEqual(calls.count[0], expected, "the total uses exactly the page filter");
        assert.equal(res.body.pagination.totalProducts, 1);
        assert.equal(calls.distinct.length, 0, "no variant lookup without a search");
    });
});

test("listAdminProducts searches variant SKUs and does not duplicate products matched by several variants", async () => {
    const { calls, stubs } = harness({ products: [product(1)], total: 1, skuIds: [oid(1)] });
    await withStubs(stubs, async () => {
        const res = response();
        await listAdminProducts({ query: { search: "sar-001" } }, res);
        assert.equal(calls.distinct[0][0], "productId", "distinct product ids, so many matching variants give one product");
        assert.ok(calls.distinct[0][1].sku instanceof RegExp);
        assert.deepEqual(calls.find[0].$or[3]._id.$in, [oid(1)]);
        assert.equal(res.body.products.length, 1);
        assert.deepEqual(calls.count[0], calls.find[0]);
    });
});

test("listAdminProducts stock filter evaluates only active variants and restricts the page to matching ids", async () => {
    const candidates = [product(1), product(2), product(3)];
    const activeVariants = [
        { productId: oid(1), ...v(1) },
        { productId: oid(2), ...v(30) },
        { productId: oid(3), ...v(4, 4) }
    ];
    const { calls, stubs } = harness({ products: candidates, total: 1, activeVariants });
    await withStubs(stubs, async () => {
        const res = response();
        await listAdminProducts({ query: { stock: "low-stock", status: "published" } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(calls.variantFind[0].active, true, "inactive variants are never loaded for stock evaluation");
        const final = calls.find.at(-1);
        assert.deepEqual(final.$and[0], { status: "published" });
        assert.deepEqual(final.$and[1]._id.$in, [oid(1)]);
        assert.deepEqual(calls.count[0], final, "total uses the same stock-restricted filter");
    });
});

test("listAdminProducts out-of-stock includes fully reserved and variant-less products", async () => {
    const candidates = [product(1), product(2), product(3)];
    const activeVariants = [{ productId: oid(1), ...v(4, 4) }, { productId: oid(2), ...v(10) }];
    const { calls, stubs } = harness({ products: candidates, total: 2, activeVariants });
    await withStubs(stubs, async () => {
        await listAdminProducts({ query: { stock: "out-of-stock" } }, response());
        assert.deepEqual(calls.find.at(-1).$and[1]._id.$in, [oid(1), oid(3)]);
    });
});

test("listAdminProducts returns a stock summary using available (not reserved) units", async () => {
    const page = [product(1)];
    const { stubs } = harness({
        products: page, total: 1,
        variantsByCall: { page: [
            { productId: oid(1), ...v(10, 4), toObject() { return { ...this }; } },
            { productId: oid(1), ...v(7, 0, { active: false }), toObject() { return { ...this }; } }
        ] }
    });
    await withStubs(stubs, async () => {
        const res = response();
        await listAdminProducts({ query: {} }, res);
        assert.deepEqual(res.body.products[0].stockSummary,
            { availableUnits: 6, activeVariantCount: 1, inactiveVariantCount: 1, state: "in-stock" });
    });
});

test("listAdminProducts uses the name collation only for name sorting and keeps the _id tie-breaker", async () => {
    for (const [sort, expectCollation] of [["name-asc", true], ["createdAt-desc", false], ["updatedAt-desc", false]]) {
        const { calls, stubs } = harness({ products: [] , total: 0 });
        await withStubs(stubs, async () => {
            await listAdminProducts({ query: { sort } }, response());
            assert.equal(calls.collation.length === 1, expectCollation, sort);
            assert.equal(Object.keys(calls.sort).at(-1), "_id", sort);
            assert.equal(calls.aggregate.length, 0, "non-price sorts do not aggregate");
        });
    }
});

// ---- price sorting: the storefront "from" price ----

const variantFor = (productId, stockOnHand, extra = {}) => ({ productId, stockOnHand, reserved: 0, active: true, ...extra });

test("startingPricePaise: no overrides uses the base price", () => {
    assert.equal(startingPricePaise(100000, [variantFor("p", 5), variantFor("p", 3)]), 100000);
});

test("startingPricePaise: several overrides use the lowest purchasable one", () => {
    const variants = [
        variantFor("p", 5, { priceOverridePaise: 120000 }),
        variantFor("p", 5, { priceOverridePaise: 90000 }),
        variantFor("p", 5, { priceOverridePaise: 150000 })
    ];
    assert.equal(startingPricePaise(100000, variants), 90000);
});

test("startingPricePaise: mixed overridden and base variants, and unpurchasable variants are ignored", () => {
    assert.equal(startingPricePaise(100000, [variantFor("p", 5, { priceOverridePaise: 130000 }), variantFor("p", 5)]), 100000);
    assert.equal(startingPricePaise(100000, [variantFor("p", 5, { priceOverridePaise: 130000 }), variantFor("p", 5, { priceOverridePaise: 70000, active: false }),
        variantFor("p", 2, { priceOverridePaise: 60000, reserved: 2 })]), 130000);
    assert.equal(startingPricePaise(100000, [variantFor("p", 0, { priceOverridePaise: 60000 })]), 100000, "none purchasable falls back to base");
    assert.equal(startingPricePaise(100000, []), 100000);
    assert.equal(startingPricePaise(100000, [variantFor("p", 5, { priceOverridePaise: 0 })]), 0, "a zero override is a real price");
});

test("price pipeline mirrors the public listing and ends with the _id tie-breaker", () => {
    for (const [sortKey, direction] of [["price-asc", 1], ["price-desc", -1]]) {
        const query = parseAdminCatalogueQuery({ sort: sortKey, page: "2", limit: "10" });
        const pipeline = buildAdminPricePipeline({ status: "published" }, query, "productvariants");
        assert.deepEqual(pipeline[0], { $match: { status: "published" } });
        const lookup = pipeline[1].$lookup;
        assert.equal(lookup.from, "productvariants");
        const expr = lookup.pipeline[0].$match.$expr.$and;
        assert.deepEqual(expr[1], { $eq: ["$active", true] }, "only active variants");
        assert.deepEqual(expr[2], { $gt: ["$stockOnHand", { $ifNull: ["$reserved", 0] }] }, "only variants with available stock");
        assert.deepEqual(lookup.pipeline[1].$project.pricePaise, { $ifNull: ["$priceOverridePaise", "$$basePrice"] });
        assert.deepEqual(pipeline[2].$addFields.startingPricePaise,
            { $ifNull: [{ $min: "$purchasablePrices.pricePaise" }, "$pricePaise"] });
        assert.deepEqual(pipeline[3].$sort, { startingPricePaise: direction, _id: 1 });
        assert.equal(Object.keys(pipeline[3].$sort).at(-1), "_id");
        assert.equal(pipeline[4].$skip, 10);
        assert.equal(pipeline[5].$limit, 10);
    }
});

test("price sort pipeline is a stand-in for Mongo: the same rule orders products ascending, descending and by _id on ties", () => {
    // Reference evaluation of the pipeline's sort key and order in JS (not a database run).
    const catalogue = [
        { _id: "3", pricePaise: 100000, variants: [variantFor("3", 5)] },
        { _id: "1", pricePaise: 100000, variants: [variantFor("1", 5, { priceOverridePaise: 80000 }), variantFor("1", 5, { priceOverridePaise: 120000 })] },
        { _id: "2", pricePaise: 100000, variants: [variantFor("2", 5, { priceOverridePaise: 150000 }), variantFor("2", 5)] },
        { _id: "4", pricePaise: 90000, variants: [] }
    ];
    const order = direction => [...catalogue]
        .map(item => ({ id: item._id, key: startingPricePaise(item.pricePaise, item.variants) }))
        .sort((a, b) => (a.key - b.key) * direction || a.id.localeCompare(b.id))
        .map(item => item.id);
    assert.deepEqual(order(1), ["1", "4", "2", "3"]);
    assert.deepEqual(order(-1), ["2", "3", "4", "1"], "ties (2 and 3 at 100000) keep ascending _id");
});

test("listAdminProducts price sort aggregates only ordered ids, keeps that order, and reports the starting price", async () => {
    const page = [product(2), product(1)];
    const { calls, stubs } = harness({
        products: [product(1), product(2)], total: 2, orderedIds: [oid(2), oid(1)],
        variantsByCall: { page: [
            { productId: oid(2), ...v(5), priceOverridePaise: 70000, toObject() { return { ...this }; } }
        ] }
    });
    await withStubs(stubs, async () => {
        const res = response();
        await listAdminProducts({ query: { sort: "price-asc", status: "published" } }, res);
        assert.equal(calls.aggregate.length, 1);
        assert.deepEqual(res.body.products.map(item => item._id), [oid(2), oid(1)]);
        assert.equal(res.body.products[0].startingPricePaise, 70000);
        assert.equal(res.body.products[1].startingPricePaise, 100000);
        assert.deepEqual(calls.count[0], { status: "published" }, "total uses the same filter");
        assert.equal(page.length, 2);
    });
});

test("listAdminProducts paginates filtered results and reports accurate totals", async () => {
    const { calls, stubs } = harness({ products: [product(1)], total: 45 });
    await withStubs(stubs, async () => {
        const res = response();
        await listAdminProducts({ query: { status: "draft", page: "3", limit: "20" } }, res);
        assert.equal(calls.skip, 40);
        assert.deepEqual(res.body.pagination, { page: 3, limit: 20, totalProducts: 45, totalPages: 3 });
    });
});

test("listAdminProducts rejects invalid filters with 400 before touching the database", async () => {
    let touched = false;
    await withStubs([
        [productModel, "find", () => { touched = true; return {}; }],
        [productModel, "countDocuments", async () => { touched = true; return 0; }],
        [productVariantModel, "distinct", async () => { touched = true; return []; }]
    ], async () => {
        for (const query of [{ status: "x" }, { stock: "x" }, { badge: "x" }, { productType: "x" }, { sort: "stock-asc" },
            { search: "a".repeat(81) }, { category: { $ne: "x" } }]) {
            const res = response();
            await listAdminProducts({ query }, res);
            assert.equal(res.statusCode, 400, JSON.stringify(query));
            assert.equal(res.body.success, false);
            assert.ok(res.body.message.length > 5);
        }
        assert.equal(touched, false);
    });
});

test("listAdminCategories returns the distinct, sorted, non-empty categories", async () => {
    await withStubs([[productModel, "distinct", async field => {
        assert.equal(field, "category");
        return ["Silk Sarees", "", "Cotton Sarees", null, "  "];
    }]], async () => {
        const res = response();
        await listAdminCategories({}, res);
        assert.deepEqual(res.body, { success: true, categories: ["Cotton Sarees", "Silk Sarees"] });
    });
});

test("the categories route requires adminAuth and is registered before /admin/:productId", () => {
    const layers = productRouter.stack.filter(item => item.route?.methods.get);
    const paths = layers.map(item => item.route.path);
    const layer = layers.find(item => item.route.path === "/admin/categories");
    assert.equal(layer.route.stack[0].handle, adminAuth);
    assert.ok(paths.indexOf("/admin/categories") < paths.indexOf("/admin/:productId"));
});
