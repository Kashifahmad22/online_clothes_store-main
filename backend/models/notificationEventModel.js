import mongoose from "mongoose";

export const NOTIFICATION_TYPES = [
    "order_placed",
    "payment_success",
    "order_dispatched",
    "out_for_delivery",
    "order_delivered",
    "return_approved",
    "refund_processed"
];
export const NOTIFICATION_CHANNELS = ["email", "whatsapp"];
export const CHANNEL_STATUSES = ["pending", "sent", "failed", "skipped"];

// Deliberately holds no recipient address, phone number or message body: those are read from the order at send time.
const channelSchema = new mongoose.Schema({
    status: { type: String, enum: CHANNEL_STATUSES, default: "pending" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    lastAttemptAt: { type: Date },
    sentAt: { type: Date },
    providerMessageId: { type: String, maxlength: 200 },
    reason: { type: String, maxlength: 80 }
}, { _id: false });

const notificationEventSchema = new mongoose.Schema({
    orderId: { type: String, required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    dedupeKey: { type: String, required: true, unique: true },
    channels: {
        email: { type: channelSchema, default: () => ({}) },
        whatsapp: { type: channelSchema, default: () => ({}) }
    }
}, { timestamps: true });

notificationEventSchema.index({ "channels.email.status": 1 });
notificationEventSchema.index({ "channels.whatsapp.status": 1 });

const notificationEventModel = mongoose.models.notificationEvent ||
    mongoose.model("notificationEvent", notificationEventSchema);
export default notificationEventModel;
