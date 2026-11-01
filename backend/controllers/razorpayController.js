import mongoose from "mongoose";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import { removePurchasedFromCart } from "../utils/cartPurchase.js";
import productVariantModel from "../models/productVariantModel.js";
import storefrontSettingsModel from "../models/storefrontSettingsModel.js";
import razorpayWebhookEventModel from "../models/razorpayWebhookEventModel.js";
import { buildOrderItems } from "./orderController.js";
import { dispatchNotifications, stageNotification } from "../utils/notifications/index.js";
import { historyEntry, recordPaymentStatus } from "../utils/orderFulfillment.js";
import { applyRefund } from "../utils/refunds.js";
import { recordAnomalies } from "../utils/paymentAnomalies.js";
import { deductAvailableStock } from "../utils/orderStock.js";
import {
    REVIEW_REASONS,
    REVIEW_REASON_LABELS,
    applyPaymentAttempt,
    flagReview,
    getPaymentBlock,
    transitionPayment
} from "../utils/paymentStateMachine.js";
import {
    calculateShippingPaise,
    calculateSubtotalPaise,
    normalizeDeliveryAddress,
    validateDeliveryAddress,
    whatsappConsentFields
} from "../utils/orderValidation.js";
import { getRazorpayTestConfig } from "../utils/razorpayConfig.js";
import { razorpayGateway } from "../utils/razorpayGateway.js";
import {
    isValidIdempotencyKey,
    validateCapturedPayment,
    validateWebhookPayment,
    verifyCheckoutSignature,
    verifyWebhookSignature
} from "../utils/paymentSecurity.js";

const RESERVATION_DURATION_MS = 15 * 60 * 1000;

export { razorpayGateway };

const apiError = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const errorBody = error => ({ success: false, message: error.message, ...(error.code ? { code: error.code } : {}) });
const getPaymentAddress = address => ({
    name: `${address.firstName} ${address.lastName}`.trim(),
    email: address.email,
    contact: address.phone
});

const makePaymentResponse = (order, keyId) => ({
    success: true,
    keyId,
    orderId: order._id.toString(),
    razorpayOrderId: order.razorpayOrderId,
    amount: order.totalPaise,
    currency: "INR",
    prefill: getPaymentAddress(order.address),
    reservationExpiresAt: order.reservationExpiresAt
});

const releaseReservation = async (order, session) => {
    if (!order.reservationHeld) return;
    for (const item of order.items) {
        const result = await productVariantModel.updateOne({
            _id: item.variantId,
            reserved: { $gte: item.quantity }
        }, { $inc: { reserved: -item.quantity } }, { session });
        if (result.modifiedCount !== 1) {
            throw new Error("Unable to safely release a reserved product variant.");
        }
    }
    order.reservationHeld = false;
};

const paymentMatchesOrder = (payment, order) =>
    payment &&
    payment.order_id === order.razorpayOrderId &&
    payment.amount === order.totalPaise &&
    payment.currency === "INR";

const settleCapturedPayment = async (order, payment, session) => {
    if (!validateCapturedPayment(payment, {
        orderId: order.razorpayOrderId,
        amountPaise: order.totalPaise
    })) {
        throw apiError("Captured payment does not match the order amount and currency.", 400);
    }

    if (order.paymentStatus === "paid" || order.paymentStatus === "refunded") {
        if (payment.id && !order.razorpayPaymentId) {
            order.razorpayPaymentId = payment.id;
            await order.save({ session });
        } else if (payment.id && payment.id !== order.razorpayPaymentId &&
            !order.duplicatePaymentIds.includes(payment.id)) {
            // A second distinct capture is evidence for review. Stock was already settled for the first one.
            order.duplicatePaymentIds.addToSet(payment.id);
            flagReview(order, order.paymentReviewReason || REVIEW_REASONS.DUPLICATE_PAYMENT, {
                note: "A second payment was captured for this order; it needs manual review."
            });
            await order.save({ session });
        }
        return;
    }

    const cancelled = order.status === "Cancelled";
    let reviewReason = "";
    let note = "";
    if (order.reservationHeld && !cancelled) {
        const reservationsValid = await Promise.all(order.items.map(item =>
            productVariantModel.exists({
                _id: item.variantId,
                reserved: { $gte: item.quantity },
                stockOnHand: { $gte: item.quantity }
            }).session(session)
        ));
        if (reservationsValid.every(Boolean)) {
            for (const item of order.items) {
                const result = await productVariantModel.updateOne({
                    _id: item.variantId,
                    reserved: { $gte: item.quantity },
                    stockOnHand: { $gte: item.quantity }
                }, {
                    $inc: {
                        stockOnHand: -item.quantity,
                        reserved: -item.quantity
                    }
                }, { session });
                if (result.modifiedCount !== 1) {
                    throw new Error("Inventory changed while confirming a captured payment.");
                }
            }
            order.reservationHeld = false;
        } else {
            await releaseReservation(order, session);
            reviewReason = REVIEW_REASONS.INVENTORY_CONFLICT;
        }
    } else {
        await releaseReservation(order, session);
        if (cancelled) {
            reviewReason = REVIEW_REASONS.ORDER_CANCELLED;
        } else if (await deductAvailableStock(order.items, session)) {
            note = "Payment captured after the reservation lapsed; stock was re-acquired.";
        } else {
            reviewReason = REVIEW_REASONS.STOCK_UNAVAILABLE;
        }
    }

    order.payment = true;
    transitionPayment(order, "paid", note ? { note } : {});
    order.razorpayPaymentId = payment.id || order.razorpayPaymentId;
    order.paidAt = new Date();
    if (reviewReason) {
        flagReview(order, reviewReason, {
            note: `Payment captured but the order is on review hold: ${REVIEW_REASON_LABELS[reviewReason]}.`
        });
    } else {
        order.fulfillmentHold = false;
        order.paymentReviewRequired = false;
        order.paymentReviewReason = "";
    }
    await order.save({ session });
    if (!cancelled) await removePurchasedFromCart(order.userId, order.items, session);
};

export const processCapturedPayment = async payment => {
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            const order = await orderModel.findOne({ razorpayOrderId: payment.order_id }).session(session);
            if (!order) throw apiError("Payment order was not found.", 404);
            await settleCapturedPayment(order, payment, session);
            // Outbox write in the same transaction; the unique event key makes a repeat verification a no-op.
            await stageNotification(order, "payment_success", { session });
        });
    } finally {
        await session.endSession();
    }
    dispatchNotifications();
};

// Event names follow Razorpay's documented webhook catalogue; they still need confirming against real test-mode deliveries.
const REFUND_EVENT_STATUS = { "refund.created": "pending", "refund.processed": "processed", "refund.failed": "failed" };
const REFUND_EVENTS = new Set(Object.keys(REFUND_EVENT_STATUS));

const processWebhookEvent = async (eventId, event, payload) => {
    const anomalies = [];
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            await razorpayWebhookEventModel.create([{ eventId, event }], { session });

            if (event === "payment.captured") {
                const payment = payload.payment?.entity;
                if (!payment || typeof payment.order_id !== "string") {
                    throw apiError("Webhook payment payload is invalid.", 400);
                }
                const order = await orderModel.findOne({ razorpayOrderId: payment.order_id }).session(session);
                if (order) {
                    await settleCapturedPayment(order, payment, session);
                    await stageNotification(order, "payment_success", { session });
                }
                return;
            }

            if (event === "order.paid") {
                const paidOrder = payload.order?.entity;
                if (!paidOrder || typeof paidOrder.id !== "string") {
                    throw apiError("Webhook order payload is invalid.", 400);
                }
                const order = await orderModel.findOne({ razorpayOrderId: paidOrder.id }).session(session);
                if (order) {
                    await settleCapturedPayment(order, {
                        order_id: paidOrder.id,
                        amount: paidOrder.amount_paid,
                        currency: paidOrder.currency,
                        status: paidOrder.status === "paid" ? "captured" : paidOrder.status
                    }, session);
                    await stageNotification(order, "payment_success", { session });
                }
                return;
            }

            if (REFUND_EVENTS.has(event)) {
                const refund = payload.refund?.entity;
                const payment = payload.payment?.entity;
                if (!refund || typeof refund.payment_id !== "string") {
                    throw apiError("Webhook refund payload is invalid.", 400);
                }
                const anomaly = kind => anomalies.push({
                    kind, source: "webhook", eventId, event, paymentId: refund.payment_id, refundId: refund.id,
                    amountPaise: refund.amount, currency: refund.currency,
                    razorpayOrderId: typeof payment?.order_id === "string" ? payment.order_id : undefined
                });
                const order = await orderModel.findOne({
                    $or: [
                        { razorpayPaymentId: refund.payment_id },
                        { duplicatePaymentIds: refund.payment_id },
                        ...(typeof payment?.order_id === "string" ? [{ razorpayOrderId: payment.order_id }] : [])
                    ]
                }).session(session);
                if (!order) {
                    anomaly("refund_unknown_order");
                    return;
                }
                // The signed entity's own status wins; the event name is only a fallback when it is absent.
                const status = ["pending", "processed", "failed"].includes(refund.status) ? refund.status : REFUND_EVENT_STATUS[event];
                const result = applyRefund(order, { ...refund, status });
                if (result.error) {
                    anomaly("refund_mismatch");
                    anomalies[anomalies.length - 1].orderId = String(order._id);
                    anomalies[anomalies.length - 1].detail = result.error;
                    throw apiError(result.error, 400);
                }
                if (result.applied) {
                    await order.save({ session });
                    if (result.becameProcessed) {
                        await stageNotification(order, "refund_processed", { session, suffix: refund.id });
                    }
                }
                return;
            }

            if (event === "payment.authorized" || event === "payment.failed") {
                const payment = payload.payment?.entity;
                if (!payment || typeof payment.order_id !== "string") {
                    throw apiError("Webhook payment payload is invalid.", 400);
                }
                const order = await orderModel.findOne({ razorpayOrderId: payment.order_id }).session(session);
                if (!order || order.paymentStatus === "paid") return;
                if (!validateWebhookPayment(payment, order, event)) {
                    throw apiError("Webhook payment does not match the order amount and currency.", 400);
                }
                // Failures never release stock: the customer may still pay in the same Razorpay modal, and
                // the expiry sweeper alone releases an unpaid reservation at its original deadline.
                const outcome = applyPaymentAttempt(order, payment, event === "payment.failed" ? "failed" : "authorized");
                if (outcome === "recorded" || outcome === "flagged") await order.save({ session });
            }
        });
        dispatchNotifications();
        return "processed";
    } finally {
        await session.endSession();
        await recordAnomalies(anomalies);
    }
};

const respondWithPaymentOrder = (res, order, status = 200, options = {}) => {
    const block = getPaymentBlock(order, options);
    if (block) return res.status(block.status).json({ success: false, code: block.code, message: block.message });
    const config = getRazorpayTestConfig();
    return res.status(status).json(makePaymentResponse(order, config.keyId));
};

export const createRazorpayOrder = async (req, res) => {
    const body = req.body || {};
    const config = getRazorpayTestConfig();
    if (!config) {
        return res.status(503).json({
            success: false,
            message: "Test-mode online payment is not configured."
        });
    }
    if (!isValidIdempotencyKey(body.idempotencyKey)) {
        return res.status(400).json({ success: false, message: "A valid checkout request key is required." });
    }
    const addressError = validateDeliveryAddress(body.address);
    if (addressError) return res.status(400).json({ success: false, message: addressError });

    let order;
    try {
        order = await orderModel.findOne({
            userId: req.auth.userId,
            idempotencyKey: body.idempotencyKey,
            paymentMethod: "Razorpay"
        });
    } catch (error) {
        console.error("Existing Razorpay order lookup failed:", { name: error.name || "Error" });
        return res.status(503).json({
            success: false,
            message: "Unable to check the existing payment order. Please try again."
        });
    }
    if (order) return respondWithPaymentOrder(res, order);

    let session;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const items = await buildOrderItems(body.items, session);
            const subtotalPaise = calculateSubtotalPaise(items);
            const settings = await storefrontSettingsModel.findOne({ key: "primary" }).session(session);
            const shippingPaise = calculateShippingPaise(subtotalPaise, settings?.shipping);
            const totalPaise = subtotalPaise + shippingPaise;
            if (!Number.isSafeInteger(totalPaise) || totalPaise < 100) {
                throw apiError("Order total is below the supported payment amount.", 400);
            }

            for (const item of items) {
                const result = await productVariantModel.updateOne({
                    _id: item.variantId,
                    productId: item.productId,
                    active: true,
                    $expr: {
                        $gte: [
                            { $subtract: ["$stockOnHand", "$reserved"] },
                            item.quantity
                        ]
                    }
                }, { $inc: { reserved: item.quantity } }, { session });
                if (result.modifiedCount !== 1) {
                    throw apiError(`Insufficient stock for ${item.name} (${item.sku}).`, 409);
                }
            }

            const user = await userModel.findById(req.auth.userId).session(session);
            if (!user) throw apiError("Customer account not found.", 404);
            const [created] = await orderModel.create([{
                userId: req.auth.userId,
                items,
                subtotalPaise,
                shippingPaise,
                totalPaise,
                address: normalizeDeliveryAddress(body.address),
                paymentMethod: "Razorpay",
                payment: false,
                paymentStatus: "pending",
                statusHistory: [
                    historyEntry({ kind: "fulfilment", to: "Order Placed", actor: "system" }),
                    historyEntry({ kind: "payment", to: "pending", actor: "system" })
                ],
                razorpaySetupStatus: "creating",
                idempotencyKey: body.idempotencyKey,
                ...whatsappConsentFields(body),
                reservationExpiresAt: new Date(Date.now() + RESERVATION_DURATION_MS),
                reservationHeld: true
            }], { session });
            order = created;
        });
    } catch (error) {
        try {
            order = await orderModel.findOne({
                userId: req.auth.userId,
                idempotencyKey: body.idempotencyKey,
                paymentMethod: "Razorpay"
            });
        } catch (lookupError) {
            console.error("Duplicate Razorpay order lookup failed:", { name: lookupError.name || "Error" });
            return res.status(503).json({
                success: false,
                message: "Payment order status could not be confirmed. Check your orders before retrying."
            });
        }
        if (order) return respondWithPaymentOrder(res, order);
        if (error.status) return res.status(error.status).json({ success: false, message: error.message });
        console.error("Razorpay order reservation failed:", { name: error.name || "Error" });
        return res.status(503).json({ success: false, message: "Unable to reserve inventory for payment." });
    } finally {
        if (session) await session.endSession();
    }

    try {
        const client = razorpayGateway.client();
        const gatewayOrder = await client.orders.create({
            amount: order.totalPaise,
            currency: "INR",
            receipt: order._id.toString(),
            notes: { internal_order_id: order._id.toString() }
        });
        if (gatewayOrder.amount !== order.totalPaise || gatewayOrder.currency !== "INR" ||
            typeof gatewayOrder.id !== "string") {
            throw new Error("Razorpay returned an unexpected order response.");
        }
        order.razorpayOrderId = gatewayOrder.id;
        order.razorpaySetupStatus = "ready";
        await order.save();
        return respondWithPaymentOrder(res, order, 201);
    } catch (error) {
        console.error("Razorpay order setup failed:", { name: error.name || "Error" });
        const cleanupSession = await mongoose.startSession();
        try {
            await cleanupSession.withTransaction(async () => {
                const failedOrder = await orderModel.findById(order._id).session(cleanupSession);
                if (!failedOrder || failedOrder.paymentStatus === "paid") return;
                await releaseReservation(failedOrder, cleanupSession);
                recordPaymentStatus(failedOrder, "failed");
                failedOrder.razorpaySetupStatus = "failed";
                await failedOrder.save({ session: cleanupSession });
            });
        } catch (cleanupError) {
            console.error("Failed to release a payment reservation:", { name: cleanupError.name || "Error" });
        } finally {
            await cleanupSession.endSession();
        }
        return res.status(503).json({
            success: false,
            message: "Payment setup failed. No payment was taken; retry checkout."
        });
    }
};

export const retryRazorpayOrder = async (req, res) => {
    if (!getRazorpayTestConfig()) {
        return res.status(503).json({ success: false, message: "Test-mode online payment is not configured." });
    }
    const orderId = req.body?.orderId;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({ success: false, message: "Invalid order ID." });
    }
    try {
        const session = await mongoose.startSession();
        let order;
        try {
            await session.withTransaction(async () => {
                order = await orderModel.findOne({
                    _id: orderId,
                    userId: req.auth.userId,
                    paymentMethod: "Razorpay"
                }).session(session);
                if (!order) throw apiError("Payment order not found.", 404, "ORDER_NOT_FOUND");
                const block = getPaymentBlock(order, { allowReacquire: true });
                if (block) throw apiError(block.message, block.status, block.code);
                if (order.paymentStatus === "pending") return;

                // Only a failed, still-payable order reaches this point.
                if (order.reservationHeld) {
                    // The original reservation and its deadline stay exactly as they were.
                    transitionPayment(order, "pending", { actor: "customer", note: "Payment retry started." });
                    await order.save({ session });
                    return;
                }
                for (const item of order.items) {
                    const result = await productVariantModel.updateOne({
                        _id: item.variantId,
                        productId: item.productId,
                        active: true,
                        $expr: {
                            $gte: [
                                { $subtract: ["$stockOnHand", "$reserved"] },
                                item.quantity
                            ]
                        }
                    }, { $inc: { reserved: item.quantity } }, { session });
                    if (result.modifiedCount !== 1) {
                        throw apiError(`Insufficient stock for ${item.name} (${item.sku}).`, 409, "INSUFFICIENT_STOCK");
                    }
                }
                order.reservationHeld = true;
                order.reservationExpiresAt = new Date(Date.now() + RESERVATION_DURATION_MS);
                transitionPayment(order, "pending", { actor: "customer", note: "Payment retry started; stock reserved again." });
                await order.save({ session });
            });
        } finally {
            await session.endSession();
        }
        return respondWithPaymentOrder(res, order);
    } catch (error) {
        if (error.status) return res.status(error.status).json(errorBody(error));
        console.error("Razorpay payment retry failed:", { name: error.name || "Error" });
        return res.status(503).json({ success: false, message: "Unable to retry payment right now." });
    }
};

// Records an authorized/failed attempt on a freshly read order inside a transaction so a concurrent capture,
// cancellation or expiry can never be overwritten by a stale copy.
const recordPaymentAttempt = async (orderId, payment, kind) => {
    const session = await mongoose.startSession();
    let current;
    try {
        await session.withTransaction(async () => {
            current = await orderModel.findById(orderId).session(session);
            if (!current) throw apiError("Payment order not found.", 404, "ORDER_NOT_FOUND");
            const outcome = applyPaymentAttempt(current, payment, kind);
            if (outcome === "recorded" || outcome === "flagged") await current.save({ session });
        });
    } finally {
        await session.endSession();
    }
    return current;
};

export const verifyRazorpayPayment = async (req, res) => {
    const config = getRazorpayTestConfig();
    if (!config) {
        return res.status(503).json({ success: false, message: "Test-mode online payment is not configured." });
    }
    const { orderId, razorpay_order_id: callbackOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } =
        req.body || {};
    if (!mongoose.Types.ObjectId.isValid(orderId) ||
        typeof callbackOrderId !== "string" ||
        typeof paymentId !== "string" ||
        typeof signature !== "string") {
        return res.status(400).json({ success: false, message: "Payment verification details are invalid." });
    }

    try {
        const order = await orderModel.findOne({
            _id: orderId,
            userId: req.auth.userId,
            paymentMethod: "Razorpay"
        });
        if (!order) return res.status(404).json({ success: false, message: "Payment order not found." });
        if (callbackOrderId !== order.razorpayOrderId ||
            !verifyCheckoutSignature(order.razorpayOrderId, paymentId, signature, config.keySecret)) {
            return res.status(400).json({ success: false, message: "Payment signature could not be verified." });
        }
        const payment = await razorpayGateway.client().payments.fetch(paymentId);
        if (!paymentMatchesOrder(payment, order)) {
            return res.status(409).json({ success: false, message: "Payment amount or currency does not match this order." });
        }
        if (payment.status === "captured") {
            await processCapturedPayment(payment);
            const updated = await orderModel.findById(order._id);
            return res.json({
                success: true,
                message: updated.fulfillmentHold
                    ? "Payment received and held for order review."
                    : "Payment confirmed.",
                paymentStatus: updated.paymentStatus,
                fulfillmentHold: updated.fulfillmentHold
            });
        }
        if (payment.status === "authorized" || payment.status === "failed") {
            const current = await recordPaymentAttempt(order._id, payment, payment.status);
            if (payment.status === "authorized") {
                return res.status(202).json({
                    success: false,
                    paymentStatus: current.paymentStatus,
                    message: "Payment is authorized but not captured yet. The order is not confirmed."
                });
            }
            // The reservation is deliberately kept: another attempt in the same payment window may still succeed.
            return res.status(402).json({
                success: false,
                paymentStatus: current.paymentStatus,
                message: "Payment failed. You may retry before the reservation expires."
            });
        }
        return res.status(202).json({
            success: false,
            paymentStatus: order.paymentStatus,
            message: "Payment is still processing. Refresh your order status shortly."
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json(errorBody(error));
        console.error("Razorpay verification failed:", { name: error.name || "Error" });
        return res.status(503).json({
            success: false,
            message: "Payment status could not be confirmed. Do not retry a charge; refresh your order status."
        });
    }
};

export const razorpayWebhook = async (req, res) => {
    const config = getRazorpayTestConfig();
    const rawBody = req.body;
    const signature = req.get("x-razorpay-signature");
    const eventId = req.get("x-razorpay-event-id");
    if (!config) return res.status(503).json({ success: false, message: "Test-mode webhook is not configured." });
    if (!Buffer.isBuffer(rawBody) || !eventId || eventId.length > 255 ||
        !verifyWebhookSignature(rawBody, signature, config.webhookSecret)) {
        return res.status(400).json({ success: false, message: "Webhook signature or event identifier is invalid." });
    }

    let payload;
    try {
        payload = JSON.parse(rawBody.toString("utf8"));
        if (typeof payload.event !== "string") throw new Error("Missing event type.");
    } catch {
        return res.status(400).json({ success: false, message: "Webhook payload is invalid." });
    }

    try {
        const result = await processWebhookEvent(eventId, payload.event, payload.payload || {});
        return res.json({ success: true, result });
    } catch (error) {
        if (error.code === 11000) return res.json({ success: true, result: "duplicate" });
        if (error.status === 400) {
            console.error("Razorpay webhook validation failed:", { event: payload.event });
            return res.status(400).json({ success: false, message: "Webhook payment data did not match the order." });
        }
        console.error("Razorpay webhook processing failed:", {
            event: payload.event,
            name: error.name || "Error"
        });
        return res.status(500).json({ success: false, message: "Webhook processing failed; provider retry is required." });
    }
};

export const releaseExpiredRazorpayReservations = async () => {
    const expiredOrders = await orderModel.find({
        paymentMethod: "Razorpay",
        reservationHeld: true,
        reservationExpiresAt: { $lte: new Date() },
        paymentStatus: { $in: ["pending", "authorized", "failed"] }
    }).select("_id").limit(100).lean();

    for (const candidate of expiredOrders) {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const order = await orderModel.findById(candidate._id).session(session);
                if (!order || !order.reservationHeld ||
                    !["pending", "authorized", "failed"].includes(order.paymentStatus) ||
                    order.reservationExpiresAt > new Date()) return;
                await releaseReservation(order, session);
                const wasAuthorized = order.paymentStatus === "authorized";
                transitionPayment(order, "expired", { note: "Payment window ended." });
                if (wasAuthorized) {
                    flagReview(order, REVIEW_REASONS.AUTHORIZED_ON_CLOSED_ORDER, {
                        hold: false,
                        note: "Reservation expired while a payment was authorized but not captured."
                    });
                }
                await order.save({ session });
            });
        } catch (error) {
            console.error("Expired Razorpay reservation release failed:", {
                orderId: candidate._id.toString(),
                name: error.name || "Error"
            });
        } finally {
            await session.endSession();
        }
    }
};
