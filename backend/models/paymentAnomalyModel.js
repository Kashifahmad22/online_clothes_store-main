import mongoose from "mongoose";

// Evidence of payment/refund data that could not be applied to an order (unknown refund, mismatched amount,
// wrong order, incomplete gateway data). Written best-effort outside the settlement transaction so a rolled
// back webhook still leaves a record. The fingerprint makes repeated reconciliation runs update one record.
const paymentAnomalySchema = new mongoose.Schema({
    fingerprint: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    source: { type: String, enum: ["webhook", "reconciliation", "refund_sync"], required: true },
    eventId: { type: String },
    event: { type: String },
    orderId: { type: String },
    razorpayOrderId: { type: String },
    paymentId: { type: String },
    refundId: { type: String },
    amountPaise: { type: Number },
    currency: { type: String },
    detail: { type: String, maxlength: 300 },
    seenCount: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    // Investigation workflow. Changing it is bookkeeping only: it never touches payments, stock or fulfilment.
    investigationStatus: { type: String, enum: ["open", "investigating", "resolved"], default: "open" },
    resolution: { type: String, maxlength: 120 },
    resolvedAt: { type: Date },
    history: {
        type: [new mongoose.Schema({
            at: { type: Date, default: Date.now },
            actor: { type: String, default: "admin" },
            from: { type: String },
            to: { type: String },
            reason: { type: String, maxlength: 120 }
        }, { _id: false })],
        default: []
    }
}, { versionKey: false });

paymentAnomalySchema.index({ lastSeenAt: -1 });

const paymentAnomalyModel = mongoose.models.paymentAnomaly || mongoose.model("paymentAnomaly", paymentAnomalySchema);
export default paymentAnomalyModel;
