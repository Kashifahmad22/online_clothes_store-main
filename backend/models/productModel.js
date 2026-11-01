import mongoose from "mongoose";

const imageSchema = new mongoose.Schema({
    url: { type: String, required: true },
    role: {
        type: String,
        enum: ["primary", "full-saree", "border", "pallu", "blouse", "detail", "lifestyle", "other"],
        default: "other"
    },
    altText: { type: String, trim: true, default: "" },
    order: { type: Number, min: 0, default: 0 }
}, { _id: false });

const productSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 180 },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    productType: {
        type: String,
        required: true,
        enum: ["saree", "suit-piece", "suit", "suit-set", "dress", "lehenga", "other"]
    },
    category: { type: String, required: true, trim: true },
    subCategory: { type: String, trim: true, default: "" },
    collections: [{ type: String, trim: true }],
    pricePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    mrpPaise: { type: Number, min: 0, validate: Number.isSafeInteger },
    images: {
        type: [imageSchema],
        validate: value => value.length > 0
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    status: {
        type: String,
        enum: ["draft", "published", "archived"],
        default: "draft",
        index: true
    },
    bestseller: { type: Boolean, default: false },
    fastSelling: { type: Boolean, default: false },
    seo: {
        title: { type: String, trim: true, maxlength: 180 },
        description: { type: String, trim: true, maxlength: 320 }
    },
    legacyData: { type: mongoose.Schema.Types.Mixed, select: false }
}, { timestamps: true, minimize: false });

productSchema.index({ status: 1, productType: 1, category: 1, createdAt: -1 });
productSchema.index(
    { slug: 1 },
    { unique: true, partialFilterExpression: { slug: { $type: "string" } } }
);

const productModel = mongoose.models.product || mongoose.model("product", productSchema);

export default productModel;
