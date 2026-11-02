import mongoose from "mongoose";

const moderationSchema = new mongoose.Schema({
    action: { type: String, enum: ["submitted", "edited", "imported", "approve", "reject", "hide", "flag"], required: true },
    from: { type: String, default: "" },
    to: { type: String, default: "" },
    actor: { type: String, enum: ["admin", "customer", "system"], default: "system" },
    reason: { type: String, maxlength: 500, default: "" },
    at: { type: Date, default: Date.now }
}, { _id: false });

const reviewSchema = new mongoose.Schema({
    productId: { type: String, required: true },
    userId: { type: String },
    orderId: { type: String },
    variantSku: { type: String, default: "" },
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    title: { type: String, trim: true, maxlength: 100, default: "" },
    body: { type: String, trim: true, maxlength: 2000, default: "" },
    displayName: { type: String, trim: true, maxlength: 60, required: true },
    // Customer review photographs live here only; they are never part of the product gallery.
    images: { type: [{ url: { type: String, required: true }, publicId: { type: String, default: "" } }], default: [], _id: false },
    status: { type: String, enum: ["pending", "approved", "rejected", "hidden", "flagged"], default: "pending" },
    // Set only by the backend from a qualifying order. Imported reviews can never be verified.
    verifiedPurchase: { type: Boolean, default: false },
    source: { type: String, enum: ["customer", "imported"], default: "customer" },
    imported: {
        type: new mongoose.Schema({
            source: { type: String, trim: true, maxlength: 100 },
            reviewDate: { type: Date },
            permissionConfirmed: { type: Boolean },
            enteredBy: { type: String, default: "admin" }
        }, { _id: false })
    },
    moderation: { type: [moderationSchema], default: [] }
}, { timestamps: true });

reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });
reviewSchema.index({ rating: 1, status: 1 });
// One customer review per product per customer; imported entries have no userId so are not constrained.
reviewSchema.index(
    { productId: 1, userId: 1 },
    { unique: true, partialFilterExpression: { source: "customer", userId: { $type: "string" } } }
);

const reviewModel = mongoose.models.review || mongoose.model("review", reviewSchema);

export default reviewModel;
