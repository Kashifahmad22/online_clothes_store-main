import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    MAX_ALT_TEXT_LENGTH,
    MAX_ATTRIBUTE_LENGTH,
    PLACEHOLDER_VALUE,
    assembleImages,
    normaliseDetailAttributes,
    parseImageAlts,
    parseProductPayload
} from "../utils/catalogueValidation.js";

const basePayload = (details, extra = {}) => ({
    name: "Silk Saree",
    description: "A saree",
    productType: "suit",
    category: "Suit Pieces",
    pricePaise: 100000,
    details,
    variants: [{ sku: "SKU-1", stockOnHand: 1 }],
    ...extra
});
const parse = (details, extra) => parseProductPayload(JSON.stringify(basePayload(details, extra)));
const reject = (details, pattern) => assert.throws(() => parse(details), pattern);
const image = (name, role = "other", altText = "") => ({ url: `https://img.test/${name}.jpg`, role, altText });
const names = list => list.map(item => item.url.split("/").pop().replace(".jpg", ""));

test("blank, missing and null fabric/colour are accepted and normalised to blank text", () => {
    assert.deepEqual(parse({}).details, {});
    assert.deepEqual(parse({ fabric: "", colour: "  " }).details, { fabric: "", colour: "" });
    assert.deepEqual(parse({ fabric: null }).details, { fabric: "" });
    assert.equal(parse(undefined).details, undefined);
});

test("valid fabric and colour are trimmed and inner whitespace collapsed", () => {
    const { details } = parse({ fabric: "  Banarasi   Silk ", colour: "\tDeep Red\n" });
    assert.equal(details.fabric, "Banarasi Silk");
    assert.equal(details.colour, "Deep Red");
});

test("placeholder values are rejected for both fields", () => {
    for (const value of ["N/A", "n/a", " NA ", "None", "NULL", "undefined", "nil", "TBD", "Not specified", "unknown", "-", "---", ".."]) {
        reject({ fabric: value }, /Fabric cannot be a placeholder/);
        reject({ colour: value }, /Colour cannot be a placeholder/);
    }
    assert.equal(parse({ fabric: "Nano Cotton", colour: "Navy" }).details.colour, "Navy");
});

test("non-text and over-long values are rejected", () => {
    reject({ fabric: 5 }, /Fabric must be text/);
    reject({ colour: ["Red"] }, /Colour must be text/);
    reject({ colour: { a: 1 } }, /Colour must be text/);
    reject({ fabric: "x".repeat(MAX_ATTRIBUTE_LENGTH + 1) }, /80 characters or fewer/);
    assert.equal(parse({ fabric: "x".repeat(MAX_ATTRIBUTE_LENGTH) }).details.fabric.length, MAX_ATTRIBUTE_LENGTH);
});

test("existing details are preserved untouched when fabric and colour are cleaned", () => {
    const details = {
        fabric: " Silk ", colour: "Red", blousePieceIncluded: true, careInstructions: "Dry clean",
        specifications: [{ label: "Weight", value: "600 g" }], legacyKey: { nested: [1, 2] }
    };
    const result = normaliseDetailAttributes(structuredClone(details));
    assert.deepEqual({ ...result, fabric: " Silk " }, details);
    assert.equal(result.fabric, "Silk");
});

test("a details payload without fabric/colour keys does not gain them", () => {
    const result = normaliseDetailAttributes({ occasion: "Wedding" });
    assert.deepEqual(result, { occasion: "Wedding" });
});

test("placeholder rule is identical in the backend, admin and storefront", () => {
    const literal = PLACEHOLDER_VALUE.toString();
    for (const file of ["../../admin/src/utils/productAttributes.js", "../../frontend/src/utils/productDisplay.js"]) {
        const source = readFileSync(new URL(file, import.meta.url), "utf8");
        assert.ok(source.includes(literal), `${file} must contain ${literal}`);
    }
});

test("image alt text: blank, trimmed, bounded and text-only", () => {
    assert.deepEqual(assembleImages([image("a", "primary", "  Front   view ")])[0].altText, "Front view");
    assert.equal(assembleImages([{ url: "https://img.test/a.jpg", role: "primary" }])[0].altText, "");
    assert.throws(() => assembleImages([image("a", "primary", "x".repeat(MAX_ALT_TEXT_LENGTH + 1))]), /alt text must be 160/);
    assert.throws(() => assembleImages([{ ...image("a", "primary"), altText: 7 }]), /alt text must be text/);
});

test("uploaded image alt text is parsed one per file", () => {
    assert.deepEqual(parseImageAlts(undefined, 2), ["", ""]);
    assert.deepEqual(parseImageAlts(JSON.stringify([" Pallu ", ""]), 2), ["Pallu", ""]);
    assert.throws(() => parseImageAlts(JSON.stringify(["a"]), 2), /one alt text for each/);
    assert.throws(() => parseImageAlts("not json", 1), /valid JSON/);
    assert.throws(() => parseImageAlts(JSON.stringify([5]), 1), /must be text/);
});

test("image order follows the submitted order and is stored as the array index", () => {
    const result = assembleImages([image("a", "primary"), image("b"), image("c")]);
    assert.deepEqual(names(result), ["a", "b", "c"]);
    assert.deepEqual(result.map(item => item.order), [0, 1, 2]);
    const reordered = assembleImages([image("a", "primary"), image("c"), image("b")]);
    assert.deepEqual(names(reordered), ["a", "c", "b"]);
    assert.deepEqual(assembleImages(reordered), reordered, "re-saving a saved order is stable");
});

test("the primary image is always stored first and keeps its role", () => {
    const result = assembleImages([image("a"), image("b"), image("c", "primary", "Cover")]);
    assert.deepEqual(names(result), ["c", "a", "b"]);
    assert.equal(result[0].role, "primary");
    assert.equal(result[0].altText, "Cover");
    assert.deepEqual(result.map(item => item.order), [0, 1, 2]);
});

test("more than one primary, or none, is rejected for a newly saved collection", () => {
    assert.throws(() => assembleImages([image("a", "primary"), image("b", "primary")]), /only one primary/);
    assert.throws(() => assembleImages([image("a"), image("b")]), /Choose one primary image/);
    assert.deepEqual(assembleImages([]), []);
});

test("retained and newly uploaded images combine in order with their alt text and roles", () => {
    const saved = [image("a", "primary", "Front"), image("b", "border", "Border detail")];
    const uploaded = [{ ...image("u1", "pallu", "Pallu"), order: 0 }];
    const result = assembleImages([...saved, ...uploaded]);
    assert.deepEqual(result.map(item => [item.url.split("/").pop(), item.role, item.altText, item.order]), [
        ["a.jpg", "primary", "Front", 0],
        ["b.jpg", "border", "Border detail", 1],
        ["u1.jpg", "pallu", "Pallu", 2]
    ]);
});
