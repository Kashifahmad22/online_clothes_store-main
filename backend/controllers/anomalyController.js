import mongoose from "mongoose";
import paymentAnomalyModel from "../models/paymentAnomalyModel.js";
import orderModel from "../models/orderModel.js";
import { reconciliationRunModel } from "../models/reconciliationRunModel.js";
import { reviewState } from "../utils/paymentReview.js";

export const INVESTIGATION_STATUSES = Object.freeze(["open", "investigating", "resolved"]);
const MAX_PAGE = 50;
const OBJECT_ID = /^[a-f\d]{24}$/i;

const statusOf = doc => doc.investigationStatus || "open";

const view = doc => ({
    id: String(doc._id),
    kind: doc.kind,
    source: doc.source,
    eventId: doc.eventId || "",
    event: doc.event || "",
    orderId: doc.orderId || "",
    razorpayOrderId: doc.razorpayOrderId || "",
    paymentId: doc.paymentId || "",
    refundId: doc.refundId || "",
    amountPaise: doc.amountPaise ?? null,
    currency: doc.currency || "",
    detail: doc.detail || "",
    seenCount: doc.seenCount || 1,
    firstSeenAt: doc.firstSeenAt,
    lastSeenAt: doc.lastSeenAt,
    investigationStatus: statusOf(doc),
    resolution: doc.resolution || "",
    resolvedAt: doc.resolvedAt || null,
    history: (doc.history || []).map(entry => ({
        at: entry.at, actor: entry.actor, from: entry.from, to: entry.to, reason: entry.reason
    }))
});

const respondError = (res, error, label) => {
    console.error(`${label} failed:`, error.message);
    return res.status(500).json({ success: false, message: `${label} failed.` });
};

// Bounded newest-first page; `before` is the lastSeenAt of the last row already shown.
export const listAnomalies = async (req, res) => {
    try {
        const { status, before, limit } = req.body || {};
        if (status !== undefined && status !== "all" && !INVESTIGATION_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, code: "INVALID_STATUS", message: "Unknown investigation status." });
        }
        const pageSize = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), MAX_PAGE) : 25;
        const filter = {};
        if (status === "open") filter.$or = [{ investigationStatus: "open" }, { investigationStatus: null }];
        else if (status && status !== "all") filter.investigationStatus = status;
        if (before !== undefined) {
            const cursor = new Date(before);
            if (Number.isNaN(cursor.getTime())) {
                return res.status(400).json({ success: false, code: "INVALID_CURSOR", message: "Invalid page cursor." });
            }
            filter.lastSeenAt = { $lt: cursor };
        }
        const rows = await paymentAnomalyModel.find(filter).sort({ lastSeenAt: -1 }).limit(pageSize + 1).lean();
        return res.json({
            success: true,
            anomalies: rows.slice(0, pageSize).map(view),
            hasMore: rows.length > pageSize
        });
    } catch (error) {
        return respondError(res, error, "Listing payment anomalies");
    }
};

const ALLOWED = { open: ["investigating", "resolved"], investigating: ["open", "resolved"], resolved: ["open"] };

// Investigation bookkeeping only. The update filter pins the status that was read, so two admins changing the
// same anomaly cannot both win, and nothing here reads or writes an order, stock or a refund.
export const setAnomalyStatus = async (req, res) => {
    try {
        const { anomalyId, status, reason } = req.body || {};
        if (typeof anomalyId !== "string" || !OBJECT_ID.test(anomalyId)) {
            return res.status(400).json({ success: false, code: "INVALID_ANOMALY", message: "A valid anomaly is required." });
        }
        if (!INVESTIGATION_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, code: "INVALID_STATUS", message: "Unknown investigation status." });
        }
        if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(reason)) {
            return res.status(400).json({ success: false, code: "REASON_REQUIRED", message: "Enter a reason of 5 to 120 characters." });
        }
        const anomaly = await paymentAnomalyModel.findById(new mongoose.Types.ObjectId(anomalyId)).lean();
        if (!anomaly) return res.status(404).json({ success: false, code: "ANOMALY_NOT_FOUND", message: "Anomaly not found." });
        const from = statusOf(anomaly);
        if (from === status) {
            return res.status(409).json({ success: false, code: "NO_CHANGE", message: `This anomaly is already ${status}.` });
        }
        if (!ALLOWED[from].includes(status)) {
            return res.status(409).json({ success: false, code: "INVALID_TRANSITION", message: `A ${from} anomaly cannot become ${status}.` });
        }
        const now = new Date();
        const trimmed = reason.trim();
        const result = await paymentAnomalyModel.updateOne(
            { _id: anomaly._id, investigationStatus: from === "open" ? { $in: ["open", null] } : from },
            {
                $set: {
                    investigationStatus: status,
                    resolution: status === "resolved" ? trimmed : "",
                    resolvedAt: status === "resolved" ? now : null
                },
                $push: { history: { at: now, actor: "admin", from, to: status, reason: trimmed } }
            }
        );
        if (!result.matchedCount) {
            return res.status(409).json({ success: false, code: "STATUS_CHANGED", message: "Another change was made first. Reload and try again." });
        }
        const updated = await paymentAnomalyModel.findById(anomaly._id).lean();
        return res.json({ success: true, anomaly: view(updated) });
    } catch (error) {
        return respondError(res, error, "Updating the anomaly");
    }
};

// Evidence behind one order's payment review: the anomaly records linked to it (these carry the payment ids of
// captures that never became the order's payment) and the order's own reconciliation record. Read-only.
export const paymentReviewDetail = async (req, res) => {
    try {
        const { orderId } = req.body || {};
        if (typeof orderId !== "string" || !OBJECT_ID.test(orderId)) {
            return res.status(400).json({ success: false, code: "INVALID_ORDER", message: "A valid order is required." });
        }
        const order = await orderModel.findById(orderId);
        if (!order) return res.status(404).json({ success: false, code: "ORDER_NOT_FOUND", message: "Order not found." });
        const links = [{ orderId }];
        if (order.razorpayOrderId) links.push({ razorpayOrderId: order.razorpayOrderId });
        const rows = await paymentAnomalyModel.find({ $or: links }).sort({ lastSeenAt: -1 }).limit(20).lean();
        const openMismatchCount = rows.filter(row =>
            row.kind === "captured_payment_mismatch" && row.investigationStatus !== "resolved").length;
        const review = reviewState(order, { openMismatchCount });
        return res.json({
            success: true,
            anomalies: rows.map(view),
            review: {
                pending: review.pending,
                reason: review.reason,
                stockDeducted: review.stockDeducted,
                reservationHeld: Boolean(order.reservationHeld),
                release: review.release,
                acknowledge: review.acknowledge
            },
            reconciliation: {
                attempts: order.reconciliation?.attempts || 0,
                lastAttemptAt: order.reconciliation?.lastAttemptAt || null,
                lastOutcome: order.reconciliation?.lastOutcome || "",
                lastDetail: order.reconciliation?.lastDetail || ""
            }
        });
    } catch (error) {
        return respondError(res, error, "Loading payment review detail");
    }
};

const runView = run => ({
    id: String(run._id),
    trigger: run.trigger,
    actor: run.actor,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || null,
    windowHours: run.windowHours ?? null,
    limit: run.limit ?? null,
    examined: run.examined || 0,
    counts: run.counts || {},
    abortReason: run.abortReason || "",
    rateLimited: /rate/i.test(run.abortReason || "")
});

export const reconciliationHistory = async (req, res) => {
    try {
        const runs = await reconciliationRunModel.find({}).sort({ startedAt: -1 }).limit(10).select("-results").lean();
        return res.json({ success: true, runs: runs.map(runView) });
    } catch (error) {
        return respondError(res, error, "Loading reconciliation history");
    }
};
