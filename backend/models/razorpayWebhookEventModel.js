import mongoose from "mongoose";

const razorpayWebhookEventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true },
    event: { type: String, required: true },
    receivedAt: { type: Date, required: true, default: Date.now }
}, { versionKey: false });

const razorpayWebhookEventModel = mongoose.models.razorpayWebhookEvent ||
    mongoose.model("razorpayWebhookEvent", razorpayWebhookEventSchema);

export default razorpayWebhookEventModel;
