import mongoose from "mongoose";

const reconciliationRunSchema = new mongoose.Schema({
    trigger: { type: String, enum: ["admin", "scheduled"], required: true },
    actor: { type: String, default: "system" },
    status: { type: String, enum: ["running", "completed", "aborted", "failed"], default: "running" },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    windowHours: { type: Number },
    limit: { type: Number },
    examined: { type: Number, default: 0 },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    abortReason: { type: String, maxlength: 100 },
    results: { type: [new mongoose.Schema({
        orderId: String,
        outcome: String,
        detail: { type: String, maxlength: 200 }
    }, { _id: false })], default: [] }
}, { versionKey: false });

// A lease, not a permanent lock: a crashed run stops blocking others once leaseExpiresAt passes.
const reconciliationLockSchema = new mongoose.Schema({
    _id: { type: String },
    owner: { type: String },
    leaseExpiresAt: { type: Date }
}, { versionKey: false });

export const reconciliationRunModel = mongoose.models.reconciliationRun ||
    mongoose.model("reconciliationRun", reconciliationRunSchema);
export const reconciliationLockModel = mongoose.models.reconciliationLock ||
    mongoose.model("reconciliationLock", reconciliationLockSchema);
