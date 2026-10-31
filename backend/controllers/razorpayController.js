import mongoose from "mongoose";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import productVariantModel from "../models/productVariantModel.js";
import storefrontSettingsModel from "../models/storefrontSettingsModel.js";
import razorpayWebhookEventModel from "../models/razorpayWebhookEventModel.js";
import { buildOrderItems } from "./orderController.js";
import { dispatchNotifications, stageNotification } from "../utils/notifications/index.js";
import { historyEntry, recordPaymentStatus } from "../utils/orderFulfillment.js";
import { applyProcessedRefund } from "../utils/orderPayments.js";
import {
    calculateShippingPaise,
    calculateSubtotalPaise,
    normalizeDeliveryAddress,
    validateDeliveryAddress,
    whatsappConsentFields
} from "../utils/orderValidation.js";
import {
    createRazorpayClient,
    getRazorpayTestConfig
} from "../utils/razorpayConfig.js";
import {
    isValidIdempotencyKey,
    validateCapturedPayment,
    validateWebhookPayment,
    verifyCheckoutSignature,
    verifyWebhookSignature
} from "../utils/paymentSecurity.js";

const RESERVATION_DURATION_MS = 15 * 60 * 1000;

// Single seam for the Razorpay SDK client so tests can substitute it and never reach the real API.
export const razorpayGateway = { client: () => createRazorpayClient() };

const apiError = (message, status = 400) => Object.assign(new Error(message), { status });
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

    if (order.paymentStatus === "paid") {
        if (payment.id && !order.razorpayPaymentId) {
            order.razorpayPaymentId = payment.id;
            await order.save({ session });
        } else if (payment.id && payment.id !== order.razorpayPaymentId) {
            order.duplicatePaymentIds.addToSet(payment.id);
            order.paymentReviewRequired = true;
            order.fulfillmentHold = true;
            await order.save({ session });
        }
        return;
    }

    let fulfillmentHold = !order.reservationHeld;
    if (order.reservationHeld) {
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
            fulfillmentHold = true;
        }
    }

    order.payment = true;
    recordPaymentStatus(order, "paid");
    order.razorpayPaymentId = payment.id || order.razorpayPaymentId;
    order.fulfillmentHold = fulfillmentHold;
    order.paidAt = new Date();
    await order.save({ session });
    await userModel.updateOne(
        { _id: order.userId },
        { $set: { cartData: {} } },
        { session }
    );
};

const processCapturedPayment = async payment => {
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

const processRefundProcessed = async (order, refund, session) => {
    const result = applyProcessedRefund(order, refund);
    if (result.error) throw apiError(result.error, 400);
    if (result.applied) await order.save({ session });
    return result;
};

const processWebhookEvent = async (eventId, event, payload) => {
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

            if (event === "refund.processed") {
                const refund = payload.refund?.entity;
                const payment = payload.payment?.entity;
                if (!refund || typeof refund.payment_id !== "string") {
                    throw apiError("Webhook refund payload is invalid.", 400);
                }
                const order = await orderModel.findOne({
                    $or: [
                        { razorpayPaymentId: refund.payment_id },
                        ...(typeof payment?.order_id === "string" ? [{ razorpayOrderId: payment.order_id }] : [])
                    ]
                }).session(session);
                if (!order) return;
                const result = await processRefundProcessed(order, refund, session);
                if (result.applied) await stageNotification(order, "refund_processed", { session, suffix: refund.id });
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
                if (event === "payment.authorized" && order.reservationHeld) {
                    recordPaymentStatus(order, "authorized");
                } else if (event === "payment.failed" && order.reservationHeld) {
                    await releaseReservation(order, session);
                    recordPaymentStatus(order, "failed");
                }
                await order.save({ session });
            }
        });
        dispatchNotifications();
        return "processed";
    } finally {
        await session.endSession();
    }
};

const respondWithPaymentOrder = (res, order, status = 200) => {
    if (order.razorpaySetupStatus !== "ready" || !order.razorpayOrderId) {
        return res.status(409).json({
            success: false,
            message: "Payment setup is not ready. Retry shortly or start a new checkout."
        });
    }
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
                if (!order) throw apiError("Payment order not found.", 404);
                const reservationActive = order.reservationHeld &&
                    order.reservationExpiresAt > new Date();
                if (order.paymentStatus === "pending" && reservationActive) return;
                if (order.paymentStatus !== "failed") {
                    throw apiError("This payment cannot be retried. Refresh your orders.", 409);
                }

                if (!order.reservationHeld) {
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
                            throw apiError(`Insufficient stock for ${item.name} (${item.sku}).`, 409);
                        }
                    }
                }
                order.reservationHeld = true;
                order.reservationExpiresAt = new Date(Date.now() + RESERVATION_DURATION_MS);
                recordPaymentStatus(order, "pending");
                await order.save({ session });
            });
        } finally {
            await session.endSession();
        }
        return respondWithPaymentOrder(res, order);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ success: false, message: error.message });
        console.error("Razorpay payment retry failed:", { name: error.name || "Error" });
        return res.status(503).json({ success: false, message: "Unable to retry payment right now." });
    }
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
        if (payment.status === "authorized") {
            if (order.reservationHeld && order.reservationExpiresAt > new Date()) {
                recordPaymentStatus(order, "authorized");
                await order.save();
            }
            return res.status(202).json({
                success: false,
                paymentStatus: order.paymentStatus,
                message: "Payment is authorized but not captured yet. The order is not confirmed."
            });
        }
        if (payment.status === "failed") {
            if (order.reservationHeld) {
                const session = await mongoose.startSession();
                try {
                    await session.withTransaction(async () => {
                        const currentOrder = await orderModel.findById(order._id).session(session);
                        if (!currentOrder || currentOrder.paymentStatus === "paid") return;
                        if (currentOrder.reservationHeld) {
                            await releaseReservation(currentOrder, session);
                            recordPaymentStatus(currentOrder, "failed");
                            await currentOrder.save({ session });
                        }
                    });
                } finally {
                    await session.endSession();
                }
            }
            return res.status(402).json({ success: false, paymentStatus: "failed", message: "Payment failed. You may retry before the reservation expires." });
        }
        return res.status(202).json({
            success: false,
            paymentStatus: order.paymentStatus,
            message: "Payment is still processing. Refresh your order status shortly."
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ success: false, message: error.message });
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
                recordPaymentStatus(order, "expired");
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
