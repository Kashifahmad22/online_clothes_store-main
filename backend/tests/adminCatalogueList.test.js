import test from "node:test";
import assert from "node:assert/strict";
import productRouter from "../routes/productRoute.js";
import adminAuth from "../middleware/adminAuth.js";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import { adminSingleProduct, listAdminProducts } from "../controllers/productController.js";
import { buildPagination, parseAdminCatalogueQuery } from "../utils/adminCatalogueQuery.js";

// These tests stub the Mongoose models. They verify query construction and response shaping only,
// not real MongoDB behaviour.
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

const makeProduct = id => ({
    _id: id,
    name: `Product ${id}`,
    status: "draft",
    pricePaise: 100000,
    toObject() { return { ...this }; }
});

test("query defaults, custom values and the maximum limit", () => {
    const defaults = parseAdminCatalogueQuery({});
    assert.deepEqual([defaults.page, defaults.limit, defaults.skip, defaults.sortKey], [1, 20, 0, "updatedAt-desc"]);
    const custom = parseAdminCatalogueQuery({ page: "3", limit: "10", sort: "createdAt-desc" });
    assert.deepEqual([custom.page, custom.limit, custom.skip], [3, 10, 20]);
    assert.equal(parseAdminCatalogueQuery({ limit: "100" }).limit, 100);
    assert.throws(() => parseAdminCatalogueQuery({ limit: "101" }), { status: 400 });
});

test("invalid page, limit and sort values and unknown parameters are rejected", () => {
    const bad = [
        { page: "0" }, { page: "-1" }, { page: "1.5" }, { page: "abc" }, { page: "" }, { page: "1e3" },
        { page: "99999999999" }, { page: ["1", "2"] }, { page: { $gt: "0" } },
        { limit: "0" }, { limit: "-5" }, { limit: "2.5" }, { limit: "1000" }, { limit: "20abc" },
        { sort: "price-asc" }, { sort: "name" }, { sort: "__proto__" }, { sort: ["updatedAt-desc"] },
        { sort: { $ne: "x" } }, { status: "draft" }, { "$where": "1" }, { search: "x" }
    ];
    for (const query of bad) {
        assert.throws(() => parseAdminCatalogueQuery(query), { status: 400 }, JSON.stringify(query));
    }
});

test("sorts always end with an _id tie-breaker", () => {
    for (const sortKey of ["updatedAt-desc", "createdAt-desc"]) {
        const keys = Object.keys(parseAdminCatalogueQuery({ sort: sortKey }).sort);
        assert.equal(keys.at(-1), "_id");
        assert.equal(keys[0], sortKey.split("-")[0]);
    }
});

test("pagination metadata, including an empty catalogue", () => {
    assert.deepEqual(buildPagination({ page: 1, limit: 20, totalProducts: 0 }),
        { page: 1, limit: 20, totalProducts: 0, totalPages: 0 });
    assert.equal(buildPagination({ page: 1, limit: 20, totalProducts: 41 }).totalPages, 3);
    assert.equal(buildPagination({ page: 1, limit: 20, totalProducts: 40 }).totalPages, 2);
});

test("listAdminProducts pages the query and fetches variants only for the page", async () => {
    const calls = {};
    const page = [makeProduct("a".repeat(24)), makeProduct("b".repeat(24))];
    await withStubs([
        [productModel, "countDocuments", async filter => { calls.count = filter; return 45; }],
        [productModel, "find", filter => {
            calls.find = filter;
            const chain = {
                sort(value) { calls.sort = value; return chain; },
                skip(value) { calls.skip = value; return chain; },
                limit(value) { calls.limit = value; return chain; },
                then(resolve, reject) { return Promise.resolve(page).then(resolve, reject); }
            };
            return chain;
        }],
        [productVariantModel, "find", filter => {
            calls.variantFilter = filter;
            return { sort(value) { calls.variantSort = value; return Promise.resolve([]); } };
        }]
    ], async () => {
        const res = response();
        await listAdminProducts({ query: { page: "2", limit: "20" } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.products.length, 2);
        assert.deepEqual(res.body.pagination, { page: 2, limit: 20, totalProducts: 45, totalPages: 3 });
        assert.deepEqual(calls.find, {});
        assert.equal(calls.skip, 20);
        assert.equal(calls.limit, 20);
        assert.deepEqual(Object.keys(calls.sort), ["updatedAt", "_id"]);
        assert.deepEqual(calls.variantFilter.productId.$in, page.map(item => item._id));
        assert.equal(Object.hasOwn(calls.variantFilter, "active"), false, "inactive variants stay included");
        assert.deepEqual(calls.variantSort, { createdAt: 1, _id: 1 });
    });
});

test("listAdminProducts handles an empty catalogue and a page past the end", async () => {
    await withStubs([
        [productModel, "countDocuments", async () => 0],
        [productModel, "find", () => {
            const chain = { sort: () => chain, skip: () => chain, limit: () => chain,
                then: (resolve, reject) => Promise.resolve([]).then(resolve, reject) };
            return chain;
        }],
        [productVariantModel, "find", () => ({ sort: () => Promise.resolve([]) })]
    ], async () => {
        const res = response();
        await listAdminProducts({ query: { page: "5" } }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body.products, []);
        assert.deepEqual(res.body.pagination, { page: 5, limit: 20, totalProducts: 0, totalPages: 0 });
    });
});

test("listAdminProducts rejects invalid queries before touching the database", async () => {
    let touched = false;
    await withStubs([
        [productModel, "countDocuments", async () => { touched = true; return 0; }],
        [productModel, "find", () => { touched = true; return {}; }]
    ], async () => {
        const res = response();
        await listAdminProducts({ query: { limit: "500" } }, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /limit/);
        assert.equal(touched, false);
    });
});

test("adminSingleProduct returns the product with active and inactive variants", async () => {
    const id = "c".repeat(24);
    const calls = {};
    await withStubs([
        [productModel, "findById", async value => { calls.id = value; return makeProduct(id); }],
        [productVariantModel, "find", filter => {
            calls.variantFilter = filter;
            return { sort: () => Promise.resolve([]) };
        }]
    ], async () => {
        const res = response();
        await adminSingleProduct({ params: { productId: id } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.product._id, id);
        assert.ok(Array.isArray(res.body.product.variants));
        assert.deepEqual(calls.variantFilter, { productId: { $in: [id] } });
    });
});

test("adminSingleProduct returns 400 for invalid ids and 404 for missing products", async () => {
    let lookedUp = false;
    await withStubs([
        [productModel, "findById", async () => { lookedUp = true; return null; }]
    ], async () => {
        for (const productId of ["not-an-id", "123456789012", "{$ne:1}", undefined]) {
            const res = response();
            await adminSingleProduct({ params: { productId } }, res);
            assert.equal(res.statusCode, 400, String(productId));
        }
        assert.equal(lookedUp, false);
        const res = response();
        await adminSingleProduct({ params: { productId: "d".repeat(24) } }, res);
        assert.equal(res.statusCode, 404);
    });
});

const routeFor = (path, method) => {
    const layer = productRouter.stack.find(item => item.route?.path === path && item.route.methods[method]);
    assert.ok(layer, `${method} ${path} must exist`);
    return layer.route.stack.map(item => item.handle);
};

test("admin read routes require adminAuth and are registered before the public :productId route", () => {
    assert.equal(routeFor("/admin/list", "get")[0], adminAuth);
    assert.equal(routeFor("/admin/:productId", "get")[0], adminAuth);
    const paths = productRouter.stack.filter(item => item.route?.methods.get).map(item => item.route.path);
    assert.ok(paths.indexOf("/admin/list") < paths.indexOf("/admin/:productId"));
    assert.ok(paths.indexOf("/admin/:productId") < paths.indexOf("/:productId"));
});

test("existing admin write routes keep adminAuth", () => {
    assert.equal(routeFor("/:productId/variants/:variantId/stock", "patch")[0], adminAuth);
    assert.equal(routeFor("/:productId/status", "patch")[0], adminAuth);
    assert.equal(routeFor("/:productId", "put")[0], adminAuth);
});
