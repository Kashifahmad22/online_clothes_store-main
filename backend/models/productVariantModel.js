import mongoose from "mongoose";

const productVariantSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "product",
        required: true,
        index: true
    },
    sku: { type: String, required: true, trim: true, uppercase: true },
    options: { type: Map, of: String, default: {} },
    priceOverridePaise: { type: Number, min: 0, validate: Number.isSafeInteger },
    stockOnHand: { type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger },
    reserved: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
    lowStockThreshold: { type: Number, min: 0, default: 2, validate: Number.isSafeInteger },
    active: { type: Boolean, default: true }
}, { timestamps: true });

productVariantSchema.index({ sku: 1 }, { unique: true });
productVariantSchema.index({ productId: 1, active: 1 });

const productVariantModel = mongoose.models.productVariant ||
    mongoose.model("productVariant", productVariantSchema);

export default productVariantModel;
