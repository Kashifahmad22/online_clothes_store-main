import test from "node:test";
import assert from "node:assert/strict";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import {
    parseImageRoles,
    parseProductPayload,
    validatePublishableProduct
} from "../utils/catalogueValidation.js";

const validSaree = () => ({
    name: "Test cotton saree",
    description: "Product facts supplied by the administrator.",
    productType: "saree",
    category: "Sarees",
    pricePaise: 125000,
    details: { blousePieceIncluded: false },
    variants: [{ sku: "PSH-CTN-001", stockOnHand: 3 }]
});

test("accepts a saree with explicit blouse-piece status and a unique SKU", () => {
    assert.equal(parseProductPayload(validSaree()).productType, "saree");
});

test("accepts the new ethnic-wear product types without changing the product schema shape", async () => {
    for (const productType of ["suit", "suit-set", "dress"]) {
        const payload = { ...validSaree(), productType, category: productType };
        assert.equal(parseProductPayload(payload).productType, productType);
        const product = new productModel({
            ...payload,
            slug: `${productType}-test`,
            images: [{ url: "https://images.example.test/product.webp", role: "primary" }]
        });
        await product.validate();
    }
});

test("Mongoose product and SKU schemas validate a catalogue record", async () => {
    const product = new productModel({
        ...validSaree(),
        slug: "test-cotton-saree",
        images: [{ url: "https://images.example.test/saree.webp", role: "primary" }]
    });
    await product.validate();
    await new productVariantModel({
        productId: product._id,
        sku: "PSH-CTN-001",
        stockOnHand: 3
    }).validate();
});

test("rejects a saree without explicit blouse-piece information", () => {
    const product = validSaree();
    product.status = "published";
    delete product.details.blousePieceIncluded;
    assert.throws(() => parseProductPayload(product), /Specify whether the blouse piece is included/);
});

test("allows a draft saree to omit unconfirmed blouse-piece information", () => {
    const product = validSaree();
    delete product.details.blousePieceIncluded;
    assert.equal(parseProductPayload(product).productType, "saree");
});

test("rejects duplicate SKUs within one product", () => {
    const product = validSaree();
    product.variants.push({ sku: "psh-ctn-001", stockOnHand: 1 });
    assert.throws(() => parseProductPayload(product), /SKUs must be unique/);
});

test("rejects unsafe prices and negative stock", () => {
    const product = validSaree();
    product.pricePaise = 12.5;
    assert.throws(() => parseProductPayload(product), /integer amount in paise/);

    product.pricePaise = 125000;
    product.variants[0].stockOnHand = -1;
    assert.throws(() => parseProductPayload(product), /non-negative whole number/);
});

test("rejects a published saree without a primary image or active SKU", () => {
    const product = validSaree();
    product.status = "published";
    assert.throws(() => validatePublishableProduct(product, []), /product image/);
    assert.throws(() => validatePublishableProduct(product, [{ role: "other" }]), /primary/);
    assert.throws(() => validatePublishableProduct({
        ...product,
        variants: [{ sku: "PSH-CTN-001", stockOnHand: 3, active: false }]
    }, [{ role: "primary" }]), /active SKU/);
});

test("validates image role count and values", () => {
    assert.deepEqual(parseImageRoles('["primary","pallu"]', 2), ["primary", "pallu"]);
    assert.throws(() => parseImageRoles('["primary"]', 2), /one image role for each/);
    assert.throws(() => parseImageRoles('["invented"]', 1), /Unsupported image role/);
});
