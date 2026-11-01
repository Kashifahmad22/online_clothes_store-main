import mongoose from "mongoose";
import orderModel from "../models/orderModel.js";
import { dispatchNotifications, stageNotification } from "./notifications/index.js";
import { classifyGatewayError, razorpayGateway, safeGatewayMessage, withTimeout } from "./razorpayGateway.js";
import { recordAnomalies } from "./paymentAnomalies.js";
import {
    STALE_REQUEST_MS,
    applyRefund,
    failRequestedRefund,
    findRefundByInternalId,
    refundStatusOf
} from "./refunds.js";

const paymentOf = (order, record) => record.paymentId || order.razorpayPaymentId;

// Looks up one in-flight refund at Razorpay. Returns { entity } | { missing: true } | { error, kind }.
const fetchGatewayRefund = async (client, order, record) => {
    const paymentId = paymentOf(order, record);
    try {
        if (record.refundId) {
            return { entity: await withTimeout(client.payments.fetchRefund(paymentId, record.refundId)) };
        }
        const list = await withTimeout(client.payments.fetchMultipleRefund(paymentId, { count: 100 }));
        if (!list || !Array.isArray(list.items)) return { error: "Incomplete refund list from Razorpay.", kind: "uncertain" };
        // Razorpay has no idempotency header; the id we sent as receipt and note is how a lost request is found again.
        const entity = list.items.find(item => item?.notes?.pshRefundId === record.internalId || item?.receipt === record.internalId);
        return entity ? { entity } : { missing: true };
    } catch (error) {
        return { error: safeGatewayMessage(error), kind: classifyGatewayError(error) };
    }
};

/**
 * Re-reads every in-flight refund on an order from Razorpay and applies what the gateway reports through the
 * same applyRefund policy as the webhook, so a sync can only move a refund forward and only on gateway evidence.
 */
export const syncOrderRefunds = async (orderId, { now = new Date() } = {}) => {
    const summary = { checked: 0, updated: 0, unresolved: 0, errors: 0, rateLimited: false };
    const order = await orderModel.findById(orderId);
    if (!order) return { ...summary, notFound: true };
    const inFlight = (order.refunds || []).filter(record => ["requested", "pending"].includes(refundStatusOf(record)));
    if (inFlight.length === 0) return summary;

    const client = razorpayGateway.client();
    for (const record of inFlight) {
        summary.checked += 1;
        const found = await fetchGatewayRefund(client, order, record);
        if (found.error) {
            if (found.kind === "rate_limited") { summary.rateLimited = true; break; }
            summary.errors += 1;
            continue;
        }
        const anomalies = [];
        const session = await mongoose.startSession();
        let notify = false;
        try {
            await session.withTransaction(async () => {
                notify = false;
                const fresh = await orderModel.findById(orderId).session(session);
                const target = record.internalId ? findRefundByInternalId(fresh, record.internalId)
                    : fresh.refunds.find(item => item.refundId === record.refundId);
                if (!target) return;
                if (found.missing) {
                    if (refundStatusOf(target) === "requested" && now - new Date(target.requestedAt || 0) > STALE_REQUEST_MS) {
                        if (failRequestedRefund(fresh, target.internalId, "No matching refund exists at Razorpay.", now)) {
                            await fresh.save({ session });
                            summary.updated += 1;
                        }
                    } else {
                        summary.unresolved += 1;
                    }
                    return;
                }
                const entity = { ...found.entity, payment_id: found.entity.payment_id || paymentOf(fresh, target) };
                if (target.internalId) entity.notes = { ...(entity.notes || {}), pshRefundId: target.internalId };
                const result = applyRefund(fresh, entity, { now });
                if (result.error) {
                    anomalies.push({
                        kind: "refund_mismatch", source: "refund_sync", orderId: String(orderId), paymentId: entity.payment_id,
                        refundId: entity.id, amountPaise: entity.amount, currency: entity.currency, detail: result.error
                    });
                    summary.errors += 1;
                    return;
                }
                if (result.applied) {
                    await fresh.save({ session });
                    summary.updated += 1;
                    if (result.becameProcessed) {
                        await stageNotification(fresh, "refund_processed", { session, suffix: entity.id });
                        notify = true;
                    }
                }
            });
        } finally {
            await session.endSession();
            await recordAnomalies(anomalies);
        }
        if (notify) dispatchNotifications();
    }
    return summary;
};
