import { createHash } from "node:crypto";
import paymentAnomalyModel from "../models/paymentAnomalyModel.js";

const clean = value => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300) : value);

const fingerprintOf = anomaly => createHash("sha256")
    .update([anomaly.kind, anomaly.source, anomaly.eventId || "", anomaly.paymentId || "", anomaly.refundId || "",
        anomaly.razorpayOrderId || "", anomaly.amountPaise ?? ""].join("|"))
    .digest("hex");

// Best effort and deliberately outside any settlement transaction: losing a log must never fail a webhook
// or reconciliation run, and a rolled-back transaction must still leave the evidence behind.
export const recordAnomalies = async anomalies => {
    for (const anomaly of anomalies) {
        try {
            const doc = Object.fromEntries(Object.entries(anomaly).map(([key, value]) => [key, clean(value)]));
            const now = new Date();
            await paymentAnomalyModel.updateOne(
                { fingerprint: fingerprintOf(doc) },
                {
                    $setOnInsert: { ...doc, firstSeenAt: now },
                    $set: { lastSeenAt: now },
                    $inc: { seenCount: 1 }
                },
                { upsert: true }
            );
        } catch (error) {
            console.error("Could not record payment anomaly:", error.message);
        }
    }
};
