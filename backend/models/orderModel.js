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

const historySchema = new mongoose.Schema({
    kind: { type: String, enum: ["fulfilment", "payment"], required: true },
    from: { type: String, default: "" },
    to: { type: String, required: true },
    at: { type: Date, default: Date.now },
    actor: { type: String, enum: ["admin", "customer", "system"], default: "system" },
    note: { type: String, maxlength: 200 }
}, { _id: false });

const refundSchema = new mongoose.Schema({
    refundId: { type: String, required: true },
    amountPaise: { type: Number, min: 1, validate: Number.isSafeInteger },
    processedAt: { type: Date }
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
    refunds: { type: [refundSchema], default: [] },
    refundedPaise: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
    statusHistory: { type: [historySchema], default: [] },
    // Explicit checkout consent to receive order updates on WhatsApp; absent on older orders, which means "no".
    whatsappOptIn: { type: Boolean, default: false, immutable: true },
    whatsappOptInAt: { type: Date, immutable: true },
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
