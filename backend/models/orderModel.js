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

// One record per refund. Records written before Phase 9.7 hold only refundId, amountPaise and processedAt and
// are always treated as processed (see refundStatusOf). Amounts are integer paise.
const refundSchema = new mongoose.Schema({
    internalId: { type: String },
    refundId: { type: String },
    paymentId: { type: String },
    amountPaise: { type: Number, min: 1, validate: Number.isSafeInteger },
    currency: { type: String },
    status: { type: String, enum: ["requested", "pending", "processed", "failed"] },
    reason: { type: String, maxlength: 120 },
    initiatedBy: { type: String, enum: ["admin", "gateway"] },
    idempotencyKey: { type: String },
    failureReason: { type: String, maxlength: 200 },
    requestedAt: { type: Date },
    updatedAt: { type: Date },
    processedAt: { type: Date }
}, { _id: false });

// A captured payment, other than the order's primary one, whose captured amount was verified with Razorpay at
// the time an admin refunded it. It gives that payment its own refund balance, separate from the order total.
const capturedPaymentSchema = new mongoose.Schema({
    paymentId: { type: String, required: true },
    razorpayOrderId: { type: String, required: true },
    amountPaise: { type: Number, min: 1, required: true, validate: Number.isSafeInteger },
    currency: { type: String, default: "INR" },
    verifiedAt: { type: Date, default: Date.now }
}, { _id: false });

const reconciliationSchema = new mongoose.Schema({
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    lastOutcome: { type: String, maxlength: 40 },
    lastDetail: { type: String, maxlength: 200 }
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
    paymentReviewReason: {
        type: String,
        enum: ["", "stock_unavailable", "inventory_conflict", "order_cancelled", "duplicate_payment", "authorized_on_closed_order", "payment_mismatch"],
        default: ""
    },
    duplicatePaymentIds: { type: [String], default: [] },
    capturedPayments: { type: [capturedPaymentSchema], default: [] },
    paidAt: { type: Date },
    refunds: { type: [refundSchema], default: [] },
    refundedPaise: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
    reconciliation: { type: reconciliationSchema, default: () => ({}) },
    statusHistory: { type: [historySchema], default: [] },
    // Explicit checkout consent to receive order updates on WhatsApp; absent on older orders, which means "no".
    whatsappOptIn: { type: Boolean, default: false, immutable: true },
    whatsappOptInAt: { type: Date, immutable: true },
    shipping: { type: shippingSchema, default: () => ({}) },
    date: { type: Number, required: true, default: Date.now }
}, { timestamps: true });

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ paymentMethod: 1, paymentStatus: 1, createdAt: -1 });
orderSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
orderSchema.index(
    { userId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

const orderModel = mongoose.models.order || mongoose.model("order", orderSchema);
export default orderModel;
