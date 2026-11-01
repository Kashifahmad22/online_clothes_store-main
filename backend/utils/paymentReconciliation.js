import { processCapturedPayment } from "../controllers/razorpayController.js";
import orderModel from "../models/orderModel.js";
import { reconciliationLockModel, reconciliationRunModel } from "../models/reconciliationRunModel.js";
import { recordAnomalies } from "./paymentAnomalies.js";
import { REVIEW_REASONS, REVIEW_REASON_LABELS, flagReview } from "./paymentStateMachine.js";
import { classifyGatewayError, razorpayGateway, safeGatewayMessage, withTimeout } from "./razorpayGateway.js";
import { syncOrderRefunds } from "./refundSync.js";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
export const DEFAULT_WINDOW_HOURS = 72;
export const MAX_WINDOW_HOURS = 168;
const LEASE_MS = 5 * 60 * 1000;
const RECENT_ATTEMPT_MS = 60 * 1000;
const REFUND_SYNC_LIMIT = 10;
const LOCK_ID = "payments";

const clampInt = (value, fallback, max) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback;
};

const matchesOrder = (payment, order) =>
    payment && typeof payment.id === "string" && payment.id.length > 0 &&
    payment.order_id === order.razorpayOrderId &&
    Number.isSafeInteger(payment.amount) && payment.amount === order.totalPaise &&
    payment.currency === "INR";

const acquireLease = async (owner, now) => {
    try {
        await reconciliationLockModel.findOneAndUpdate(
            { _id: LOCK_ID, leaseExpiresAt: { $lt: now } },
            { $set: { owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } },
            { upsert: true }
        );
        return true;
    } catch (error) {
        // The upsert collides with the live lock document when another run holds an unexpired lease.
        if (error?.code === 11000) return false;
        throw error;
    }
};

const releaseLease = owner =>
    reconciliationLockModel.updateOne({ _id: LOCK_ID, owner }, { $set: { leaseExpiresAt: new Date(0) } }).catch(() => {});

const buildCandidateFilter = ({ orderId, since, now }) => {
    if (orderId) return { _id: orderId, paymentMethod: "Razorpay", razorpayOrderId: { $type: "string" } };
    return {
        paymentMethod: "Razorpay",
        razorpayOrderId: { $type: "string" },
        createdAt: { $gte: since },
        $or: [
            { paymentStatus: { $in: ["pending", "authorized", "failed", "expired"] } },
            { paymentStatus: "paid", fulfillmentHold: true }
        ],
        "reconciliation.lastAttemptAt": { $not: { $gt: new Date(now.getTime() - RECENT_ATTEMPT_MS) } }
    };
};

const reconcileOrder = async (order, client, now) => {
    const id = String(order._id);
    if (order.paymentStatus === "paid" && order.fulfillmentHold) {
        // A hold needs a person. Reconciliation reports it and never clears or fulfils it.
        return { outcome: "needs_review", detail: order.paymentReviewReason || "fulfilment hold" };
    }

    let list;
    try {
        list = await withTimeout(client.orders.fetchPayments(order.razorpayOrderId));
    } catch (error) {
        if (error?.code === "GATEWAY_TIMEOUT") return { outcome: "timeout", detail: "Razorpay did not respond in time." };
        const kind = classifyGatewayError(error);
        if (kind === "rate_limited") return { outcome: "rate_limited", detail: "Razorpay rate limit reached.", abort: true };
        return { outcome: "gateway_error", detail: safeGatewayMessage(error) };
    }
    if (!list || !Array.isArray(list.items)) {
        return { outcome: "incomplete_evidence", detail: "Razorpay returned no payment list." };
    }

    const captured = list.items.filter(item => item?.status === "captured").sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    if (captured.length === 0) return { outcome: "no_capture", detail: "No captured payment at Razorpay." };

    const anomalies = [];
    const valid = [];
    for (const payment of captured) {
        if (matchesOrder(payment, order)) valid.push(payment);
        else {
            anomalies.push({
                kind: "captured_payment_mismatch", source: "reconciliation", orderId: id,
                razorpayOrderId: order.razorpayOrderId, paymentId: typeof payment?.id === "string" ? payment.id : undefined,
                amountPaise: Number.isSafeInteger(payment?.amount) ? payment.amount : undefined, currency: payment?.currency,
                detail: `Expected ${order.totalPaise} INR paise on ${order.razorpayOrderId}.`
            });
        }
    }
    await recordAnomalies(anomalies);

    if (valid.length === 0) {
        const fresh = await orderModel.findById(order._id);
        if (fresh && !fresh.paymentReviewRequired) {
            flagReview(fresh, REVIEW_REASONS.PAYMENT_MISMATCH, {
                hold: false, note: `Reconciliation: ${REVIEW_REASON_LABELS[REVIEW_REASONS.PAYMENT_MISMATCH]}.`
            });
            await fresh.save();
        }
        return { outcome: "mismatch", detail: "Captured payment does not match the order." };
    }

    const known = new Set([order.razorpayPaymentId, ...(order.duplicatePaymentIds || [])].filter(Boolean));
    const settledAlready = order.paymentStatus === "paid" || order.paymentStatus === "refunded";
    const fresh = valid.filter(payment => !known.has(payment.id));
    if (settledAlready && fresh.length === 0) return { outcome: "already_settled", detail: "" };

    try {
        for (const payment of valid) await processCapturedPayment(payment);
    } catch (error) {
        return { outcome: "error", detail: String(error.message).slice(0, 200) };
    }
    const after = await orderModel.findById(order._id);
    if (settledAlready) return { outcome: "duplicate_recorded", detail: `${fresh.length} extra capture(s) recorded for review.` };
    if (after?.paymentStatus !== "paid") return { outcome: "error", detail: "Order was not settled." };
    return after.fulfillmentHold
        ? { outcome: "settled_on_hold", detail: after.paymentReviewReason || "hold" }
        : { outcome: "settled", detail: "" };
};

/**
 * Finds Razorpay payments captured at the gateway but never settled by the app, and settles them through the
 * same settleCapturedPayment path the webhook uses. Safe to repeat: settlement is idempotent, a lease lock
 * prevents overlapping runs, and every run is bounded by `limit` and `windowHours`.
 */
export const reconcilePayments = async ({ trigger = "admin", actor = "admin", limit, windowHours, orderId, now = new Date() } = {}) => {
    const runLimit = clampInt(limit, DEFAULT_LIMIT, MAX_LIMIT);
    const runWindow = clampInt(windowHours, DEFAULT_WINDOW_HOURS, MAX_WINDOW_HOURS);
    const owner = `${trigger}:${actor}:${now.getTime()}`;

    if (!(await acquireLease(owner, now))) {
        return { started: false, code: "RECONCILIATION_RUNNING", message: "A reconciliation run is already in progress." };
    }

    const counts = {};
    const results = [];
    let status = "completed";
    let abortReason;
    let examined = 0;
    let run;
    try {
        run = await reconciliationRunModel.create({ trigger, actor, windowHours: runWindow, limit: runLimit, startedAt: now });
        const client = razorpayGateway.client();
        const since = new Date(now.getTime() - runWindow * 3600 * 1000);
        const candidates = await orderModel.find(buildCandidateFilter({ orderId, since, now }))
            .sort({ "reconciliation.lastAttemptAt": 1, createdAt: 1 })
            .limit(orderId ? 1 : runLimit)
            .lean();

        for (const order of candidates) {
            examined += 1;
            const result = await reconcileOrder(order, client, now);
            counts[result.outcome] = (counts[result.outcome] || 0) + 1;
            results.push({ orderId: String(order._id), outcome: result.outcome, detail: (result.detail || "").slice(0, 200) });
            await orderModel.updateOne({ _id: order._id }, {
                $set: {
                    "reconciliation.lastAttemptAt": now,
                    "reconciliation.lastOutcome": result.outcome,
                    "reconciliation.lastDetail": (result.detail || "").slice(0, 200)
                },
                $inc: { "reconciliation.attempts": 1 }
            });
            if (result.abort) {
                status = "aborted";
                abortReason = "rate_limited";
                break;
            }
        }

        if (status === "completed" && !orderId) {
            const refundOrders = await orderModel.find({ "refunds.status": { $in: ["requested", "pending"] } })
                .sort({ updatedAt: 1 }).limit(REFUND_SYNC_LIMIT).select("_id").lean();
            let synced = 0;
            for (const refundOrder of refundOrders) {
                const summary = await syncOrderRefunds(refundOrder._id, { now });
                synced += summary.updated || 0;
                if (summary.rateLimited) {
                    status = "aborted";
                    abortReason = "rate_limited";
                    break;
                }
            }
            counts.refunds_updated = synced;
        }
    } catch (error) {
        status = "failed";
        abortReason = String(error.message).slice(0, 100);
    } finally {
        await releaseLease(owner);
        if (run) {
            await reconciliationRunModel.updateOne({ _id: run._id }, {
                $set: { status, finishedAt: new Date(), examined, counts, results: results.slice(0, 100), abortReason }
            }).catch(() => {});
        }
    }
    return { started: true, status, examined, counts, results, ...(abortReason ? { abortReason } : {}) };
};
