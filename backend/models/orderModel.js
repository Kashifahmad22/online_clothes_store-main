import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
    productId: { type: String, ref: "product" },
    variantId: { type: String, ref: "productVariant" },
    sku: { type: String },
    name: { type: String },
    image: { type: [String], default: [] },
    quantity: { type: Number, min: 1, validate: Number.isSafeInteger },
    unitPricePaise: { type: Number, min: 0, validate: Number.isSafeInteger },
    price: { type: Number },
    size: { type: String }
}, { _id: false, strict: false });

const shippingSchema = new mongoose.Schema({
    courierName: { type: String, trim: true, maxlength: 100, default: "" },
    trackingNumber: { type: String, trim: true, maxlength: 100, default: "" },
    trackingUrl: { type: String, trim: true, maxlength: 2048, default: "" },
    dispatchDate: { type: Date },
    notes: { type: String, trim: true, maxlength: 1000, default: "" }
}, { _id: false });

const orderSchema = new mongoose.Schema({
    userId: { type: String, ref: "user", required: true, index: true },
    items: { type: [orderItemSchema], required: true, validate: value => value.length > 0 },
    subtotalPaise: { type: Number, min: 0, validate: Number.isSafeInteger },
    shippingPaise: { type: Number, min: 0, validate: Number.isSafeInteger },
    totalPaise: { type: Number, min: 0, validate: Number.isSafeInteger },
    amount: { type: Number },
    address: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
        type: String,
        required: true,
        default: "Order Placed"
    },
    paymentMethod: { type: String, required: true },
    payment: { type: Boolean, required: true, default: false },
    paymentStatus: {
        type: String,
        enum: ["cod_pending", "pending", "authorized", "paid", "failed", "expired", "refunded"],
        default: "cod_pending"
    },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySetupStatus: { type: String, enum: ["creating", "ready", "failed"] },
    idempotencyKey: { type: String },
    reservationExpiresAt: { type: Date },
    reservationHeld: { type: Boolean, default: false },
    fulfillmentHold: { type: Boolean, default: false },
    paymentReviewRequired: { type: Boolean, default: false },
    duplicatePaymentIds: { type: [String], default: [] },
    paidAt: { type: Date },
    shipping: { type: shippingSchema, default: () => ({}) },
    date: { type: Number, required: true, default: Date.now }
}, { timestamps: true });

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
orderSchema.index(
    { userId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

const orderModel = mongoose.models.order || mongoose.model("order", orderSchema);
export default orderModel;
