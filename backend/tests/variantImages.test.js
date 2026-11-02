import test from "node:test";
import assert from "node:assert/strict";
import {
    assembleImages,
    imagesForVariant,
    imagesUnchanged,
    parseImageVariants
} from "../utils/catalogueValidation.js";

const gallery = [
    { url: "a", role: "primary", variantSku: "" },
    { url: "red", role: "other", variantSku: "SKU-RED" },
    { url: "blue", role: "other", variantSku: "SKU-BLUE" }
];

test("variant gallery shows own photos first, then shared, never another colour", () => {
    assert.deepEqual(imagesForVariant(gallery, "sku-red").map(i => i.url), ["red", "a"]);
    assert.deepEqual(imagesForVariant(gallery, "SKU-GREEN").map(i => i.url), ["a"]);
});

test("legacy untagged galleries are unchanged", () => {
    const legacy = [{ url: "x", role: "primary" }, { url: "y", role: "other" }];
    assert.deepEqual(imagesForVariant(legacy, "SKU-RED").map(i => i.url), ["x", "y"]);
});

test("assembleImages normalises and validates variantSku", () => {
    const [first, second] = assembleImages([
        { url: "a", role: "primary" },
        { url: "b", role: "other", variantSku: " sku-red " }
    ]);
    assert.equal(first.variantSku, "");
    assert.equal(second.variantSku, "SKU-RED");
    assert.throws(() => assembleImages([{ url: "a", role: "primary", variantSku: "bad sku!" }]));
});

test("parseImageVariants requires one entry per upload", () => {
    assert.deepEqual(parseImageVariants(undefined, 2), ["", ""]);
    assert.deepEqual(parseImageVariants('["sku-1",""]', 2), ["SKU-1", ""]);
    assert.throws(() => parseImageVariants('["SKU-1"]', 2));
    assert.throws(() => parseImageVariants("nope", 1));
});

test("changing only the colour tag counts as an image edit", () => {
    const stored = [{ url: "a", role: "primary", altText: "", variantSku: "" }];
    assert.equal(imagesUnchanged([{ ...stored[0] }], stored), true);
    assert.equal(imagesUnchanged([{ ...stored[0], variantSku: "SKU-RED" }], stored), false);
});

test("tagging an image to a SKU that is not a variant of the product is rejected", async () => {
    const { assertImageSkusExist } = await import("../utils/catalogueValidation.js");
    assert.doesNotThrow(() => assertImageSkusExist([{ variantSku: "SKU-RED" }, { variantSku: "" }], ["sku-red", "SKU-BLUE"]));
    assert.throws(() => assertImageSkusExist([{ variantSku: "SKU-GONE" }], ["SKU-RED"]), /not a variant/);
});

test("no variant context returns the whole gallery so tagged-only products still have a photo", () => {
    const tagged = [{ url: "r", variantSku: "SKU-RED" }];
    assert.deepEqual(imagesForVariant(tagged, "").map(i => i.url), ["r"]);
    assert.deepEqual(imagesForVariant(tagged, "SKU-BLUE"), []);
});
