import test from "node:test";
import assert from "node:assert/strict";
import productModel from "../models/productModel.js";
import { listCatalogueFacets } from "../controllers/productController.js";

test("public facets expose only fabric, colour and occasion values, never categories or product types", async () => {
    const distinctFields = [];
    const original = productModel.distinct;
    productModel.distinct = async (field, filter) => {
        distinctFields.push([field, filter]);
        if (field === "category") return ["Suit Pants", "Silk Sarees", "Suit Piece", "sarees", "Sarees"];
        if (field === "productType") return ["saree", "other"];
        return ["Silk", " Cotton ", "", null];
    };
    try {
        const res = { json(body) { res.body = body; return res; }, status() { return res; } };
        await listCatalogueFacets({}, res);
        assert.equal(res.body.success, true);
        assert.deepEqual(Object.keys(res.body.facets).sort(), ["colours", "fabrics", "occasions"]);
        assert.equal(distinctFields.some(([field]) => field === "category" || field === "productType"), false);
        assert.ok(distinctFields.every(([, filter]) => filter.status === "published"));
        assert.deepEqual(res.body.facets.fabrics, ["Cotton", "Silk"]);
    } finally {
        productModel.distinct = original;
    }
});
