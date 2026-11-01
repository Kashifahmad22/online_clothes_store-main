import mongoose from "mongoose";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import storefrontSettingsModel from "../models/storefrontSettingsModel.js";
import {
    calculateSubtotalPaise,
    calculateShippingPaise,
    normalizeDeliveryAddress,
    validateDeliveryAddress,
    whatsappConsentFields
} from "../utils/orderValidation.js";
import { isValidIdempotencyKey } from "../utils/paymentSecurity.js";
import {
    FULFILLMENT_STATUSES,
    PHYSICAL_FULFILMENT_STATUSES,
    hasDispatchDetails,
    historyEntry,
    isEligibleForPrepaidFulfillment,
    isValidFulfillmentTransition,
    normalizeShippingDetails,
    recordFulfilmentStatus
} from "../utils/orderFulfillment.js";
import { markCodCollected } from "../utils/orderPayments.js";
import { removePurchasedFromCart } from "../utils/cartPurchase.js";
import { reviewState } from "../utils/paymentReview.js";
import paymentAnomalyModel from "../models/paymentAnomalyModel.js";
import { deductAvailableStock } from "../utils/orderStock.js";
import {
    REVIEW_REASONS,
    STOCK_NOT_DEDUCTED_REASONS,
    effectiveReviewReason,
    flagReview,
    transitionPayment
} from "../utils/paymentStateMachine.js";
import { serializeAdminOrder, serializeCustomerOrder } from "../utils/orderSerializers.js";
import { dispatchNotifications, notifications, stageNotification } from "../utils/notifications/index.js";

// Notification event raised when an order enters a fulfilment status.
const STATUS_NOTIFICATIONS = {
    Shipped: "order_dispatched",
    "Out for delivery": "out_for_delivery",
    Delivered: "order_delivered",
    "Return Approved": "return_approved"
};

export const buildOrderItems = async (items, session) => {
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        throw Object.assign(new Error("Cart must contain between 1 and 50 distinct items."), { status: 400 });
    }

    const normalized = new Map();
    for (const item of items) {
        const { productId, variantId, quantity } = item || {};
        if (!mongoose.Types.ObjectId.isValid(productId) ||
            !mongoose.Types.ObjectId.isValid(variantId) ||
            !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
            throw Object.assign(new Error("Cart contains an invalid product, variant, or quantity."), { status: 400 });
        }
        if (normalized.has(variantId)) {
            throw Object.assign(new Error("Cart contains a duplicate variant."), { status: 400 });
        }
        normalized.set(variantId, { productId, variantId, quantity });
    }

    const productIds = [...new Set([...normalized.values()].map(item => item.productId))];
    const variantIds = [...normalized.keys()];
    const [products, variants] = await Promise.all([
        productModel.find({ _id: { $in: productIds }, status: "published" }).session(session),
        productVariantModel.find({
            _id: { $in: variantIds },
            productId: { $in: productIds },
            active: true
        }).session(session)
    ]);
    const productsById = new Map(products.map(product => [product._id.toString(), product]));
    const variantsById = new Map(variants.map(variant => [variant._id.toString(), variant]));

    const orderItems = [];
    for (const item of normalized.values()) {
        const product = productsById.get(item.productId);
        const variant = variantsById.get(item.variantId);
        if (!product || !variant || variant.productId.toString() !== item.productId) {
            throw Object.assign(new Error("A cart item is no longer available."), { status: 409 });
        }
        const unitPricePaise = variant.priceOverridePaise ?? product.pricePaise;
        if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0 ||
            !Number.isSafeInteger(unitPricePaise * item.quantity)) {
            throw Object.assign(new Error("A cart item has an invalid price."), { status: 400 });
        }
        orderItems.push({
            productId: product._id.toString(),
            variantId: variant._id.toString(),
            sku: variant.sku,
            name: product.name,
            image: product.images.map(image => image.url),
            quantity: item.quantity,
            unitPricePaise
        });
    }
    return orderItems;
};

const serializeOrder = serializeCustomerOrder;

// Read-only price/stock confirmation for the checkout summary. Nothing is reserved or written.
const quoteOrder = async (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        return res.status(400).json({ success: false, message: "Cart must contain between 1 and 50 distinct items." });
    }
    const seen = new Set();
    for (const item of items) {
        const { productId, variantId, quantity } = item || {};
        if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(variantId) ||
            !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99 || seen.has(String(variantId))) {
            return res.status(400).json({ success: false, message: "Cart contains an invalid product, variant, or quantity." });
        }
        seen.add(String(variantId));
    }

    try {
        const [products, variants, settings] = await Promise.all([
            productModel.find({ _id: { $in: items.map(item => item.productId) }, status: "published" }),
            productVariantModel.find({ _id: { $in: items.map(item => item.variantId) }, active: true }),
            storefrontSettingsModel.findOne({ key: "primary" })
        ]);
        const productsById = new Map(products.map(product => [product._id.toString(), product]));
        const variantsById = new Map(variants.map(variant => [variant._id.toString(), variant]));

        const lines = items.map(({ productId, variantId, quantity }) => {
            const product = productsById.get(String(productId));
            const variant = variantsById.get(String(variantId));
            if (!product || !variant || variant.productId.toString() !== String(productId)) {
                return { productId, variantId, quantity, status: "unavailable" };
            }
            const unitPricePaise = variant.priceOverridePaise ?? product.pricePaise;
            const available = Math.max(0, variant.stockOnHand - (variant.reserved || 0));
            const options = variant.options instanceof Map ? Object.fromEntries(variant.options) : { ...(variant.options || {}) };
            return {
                productId, variantId, quantity,
                name: product.name,
                image: product.images?.[0]?.url || "",
                options,
                unitPricePaise,
                lineTotalPaise: unitPricePaise * quantity,
                status: available >= quantity ? "ok" : "insufficient",
                availableQuantity: available >= quantity ? undefined : available
            };
        });
        const priced = lines.filter(line => Number.isSafeInteger(line.unitPricePaise));
        const subtotalPaise = priced.reduce((sum, line) => sum + line.lineTotalPaise, 0);
        const shippingPaise = calculateShippingPaise(subtotalPaise, settings?.shipping);
        return res.json({
            success: true,
            lines,
            subtotalPaise,
            shippingPaise,
            totalPaise: subtotalPaise + shippingPaise,
            hasIssues: lines.some(line => line.status !== "ok")
        });
    } catch (error) {
        console.error("Checkout quote failed:", { name: error.name || "Error" });
        return res.status(error.status || 500).json({ success: false, message: "Unable to confirm prices right now." });
    }
};

const placeOrder = async (req, res) => {
    const body = req.body || {};
    if (!isValidIdempotencyKey(body.idempotencyKey)) {
        return res.status(400).json({ success: false, message: "A valid checkout request key is required." });
    }
    const addressError = validateDeliveryAddress(body.address);
    if (addressError) return res.status(400).json({ success: false, message: addressError });
    const address = normalizeDeliveryAddress(body.address);

    let session;
    try {
        const existingOrder = await orderModel.findOne({
            userId: req.auth.userId,
            idempotencyKey: body.idempotencyKey,
            paymentMethod: "COD"
        });
        if (existingOrder) {
            return res.json({
                success: true,
                message: "This checkout request was already placed.",
                order: serializeOrder(existingOrder)
            });
        }

        session = await mongoose.startSession();
        let savedOrder;
        await session.withTransaction(async () => {
            const items = await buildOrderItems(body.items, session);
            const subtotalPaise = calculateSubtotalPaise(items);
            const settings = await storefrontSettingsModel.findOne({ key: "primary" }).session(session);
            const shippingPaise = calculateShippingPaise(subtotalPaise, settings?.shipping);

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
                }, { $inc: { stockOnHand: -item.quantity } }, { session });
                if (result.modifiedCount !== 1) {
                    throw Object.assign(
                        new Error(`Insufficient stock for ${item.name} (${item.sku}).`),
                        { status: 409 }
                    );
                }
            }

            const totalPaise = subtotalPaise + shippingPaise;
            if (!Number.isSafeInteger(totalPaise)) {
                throw Object.assign(new Error("Order total exceeds the supported amount."), { status: 400 });
            }
            const user = await userModel.findById(req.auth.userId).session(session);
            if (!user) {
                throw Object.assign(new Error("Customer account not found."), { status: 404 });
            }
            const [saved] = await orderModel.create([{
                userId: req.auth.userId,
                items,
                subtotalPaise,
                shippingPaise,
                totalPaise,
                address,
                paymentMethod: "COD",
                payment: false,
                paymentStatus: "cod_pending",
                statusHistory: [
                    historyEntry({ kind: "fulfilment", to: "Order Placed", actor: "system" }),
                    historyEntry({ kind: "payment", to: "cod_pending", actor: "system" })
                ],
                idempotencyKey: body.idempotencyKey,
                ...whatsappConsentFields(body),
                date: Date.now()
            }], { session });
            await removePurchasedFromCart(req.auth.userId, items, session);
            await stageNotification(saved, "order_placed", { session });
            savedOrder = saved;
        });
        dispatchNotifications();
        return res.status(201).json({
            success: true,
            message: "Order placed.",
            order: serializeOrder(savedOrder)
        });
    } catch (error) {
        let duplicateOrder;
        try {
            duplicateOrder = await orderModel.findOne({
                userId: req.auth.userId,
                idempotencyKey: body.idempotencyKey,
                paymentMethod: "COD"
            });
        } catch (lookupError) {
            console.error("Duplicate COD order lookup failed:", { name: lookupError.name || "Error" });
            return res.status(503).json({
                success: false,
                message: "Order status could not be confirmed. Refresh your orders before retrying."
            });
        }
        if (duplicateOrder) {
            return res.json({
                success: true,
                message: "This checkout request was already placed.",
                order: serializeOrder(duplicateOrder)
            });
        }
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: "Unable to place a duplicate order." });
        }
        console.error("Order placement failed:", { name: error.name || "Error" });
        return res.status(503).json({
            success: false,
            message: "Order placement is temporarily unavailable. Please try again."
        });
    } finally {
        if (session) await session.endSession();
    }
};

const paymentUnavailable = (req, res) => res.status(503).json({
    success: false,
    message: "Online payment is not available yet. No payment has been taken."
});

const allOrders = async (req, res) => {
    try {
        const orders = await orderModel.find({}).sort({ date: -1 }).limit(500);
        return res.json({ success: true, orders: orders.map(serializeAdminOrder) });
    } catch (error) {
        console.error("Admin order list failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to load orders." });
    }
};

const userOrders = async (req, res) => {
    try {
        const orders = await orderModel.find({ userId: req.auth.userId }).sort({ date: -1 });
        return res.json({ success: true, orders: orders.map(serializeOrder) });
    } catch (error) {
        console.error("Customer order list failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to load orders." });
    }
};

const statusError = (message, status, code) => Object.assign(new Error(message), { status, code });

// Cancels a prepaid order without leaving it payable and without discarding evidence of a payment.
// It never marks anything refunded: only a Razorpay-confirmed refund event does that.
const cancelPrepaidOrder = async (order, session) => {
    if (order.paymentStatus === "paid") {
        const stockNotDeducted = order.fulfillmentHold &&
            STOCK_NOT_DEDUCTED_REASONS.includes(effectiveReviewReason(order));
        if (!stockNotDeducted) {
            throw statusError(
                "Paid prepaid orders cannot be cancelled until a refund workflow is available.",
                409,
                "PAID_ORDER_REQUIRES_REFUND"
            );
        }
        // Paid, no stock was ever deducted: cancelling changes no stock and keeps the payment under review.
        flagReview(order, REVIEW_REASONS.ORDER_CANCELLED, {
            note: "Order cancelled while its payment was under review. The payment has not been refunded."
        });
        return;
    }
    if (order.paymentStatus === "refunded") return;

    if (order.reservationHeld) {
        for (const item of order.items) {
            const result = await productVariantModel.updateOne({
                _id: item.variantId,
                reserved: { $gte: item.quantity }
            }, { $inc: { reserved: -item.quantity } }, { session });
            if (result.modifiedCount !== 1) {
                throw new Error("Unable to safely release stock for the cancelled prepaid order.");
            }
        }
        order.reservationHeld = false;
    }
    if (order.paymentStatus === "authorized") {
        // The gateway may still capture this payment, so the evidence stays visible and the order stays flagged.
        flagReview(order, REVIEW_REASONS.AUTHORIZED_ON_CLOSED_ORDER, {
            note: "Order cancelled while a payment was authorized; check Razorpay before any refund."
        });
    } else if (order.paymentStatus === "pending" || order.paymentStatus === "failed") {
        transitionPayment(order, "expired", { actor: "admin", note: "Order cancelled; payment no longer accepted." });
    }
};

const updateStatus = async (req, res) => {
    const body = req.body || {};
    const { orderId, status } = body;
    if (!mongoose.Types.ObjectId.isValid(orderId) ||
        typeof status !== "string" ||
        !FULFILLMENT_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid order ID or status." });
    }

    let session;
    let transitioned = false;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            transitioned = false;
            const order = await orderModel.findById(orderId).session(session);
            if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
            if (!isValidFulfillmentTransition(order.status, status)) {
                throw Object.assign(new Error(`Order cannot move from ${order.status} to ${status}.`), { status: 409 });
            }
            if (order.status === status) return;
            if (PHYSICAL_FULFILMENT_STATUSES.includes(status) &&
                !isEligibleForPrepaidFulfillment(order)) {
                throw Object.assign(
                    new Error("This prepaid order is unpaid or on payment review hold and cannot be fulfilled."),
                    { status: 409 }
                );
            }
            if (status === "Shipped" && !hasDispatchDetails(order.shipping)) {
                throw Object.assign(
                    new Error("Add the courier name and tracking number before marking this order shipped."),
                    { status: 409 }
                );
            }
            if (status === "Cancelled") {
                if (order.paymentMethod === "Razorpay") {
                    await cancelPrepaidOrder(order, session);
                } else if (order.paymentMethod === "COD") {
                    for (const item of order.items) {
                        const result = await productVariantModel.updateOne(
                            { _id: item.variantId },
                            { $inc: { stockOnHand: item.quantity } },
                            { session }
                        );
                        if (result.modifiedCount !== 1) {
                            throw new Error("Unable to safely restore stock for the cancelled COD order.");
                        }
                    }
                }
            }
            if (status === "Shipped") {
                order.shipping.dispatchDate = new Date();
            }
            recordFulfilmentStatus(order, status, "admin");
            await order.save({ session });
            if (STATUS_NOTIFICATIONS[status]) await stageNotification(order, STATUS_NOTIFICATIONS[status], { session });
            transitioned = true;
        });
        if (transitioned) dispatchNotifications();
        return res.json({ success: true, message: "Order status updated." });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({
                success: false,
                message: error.message,
                ...(error.code ? { code: error.code } : {})
            });
        }
        console.error("Order status update failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to update order status." });
    } finally {
        if (session) await session.endSession();
    }
};

const updateShipping = async (req, res) => {
    const body = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(body.orderId)) {
        return res.status(400).json({ success: false, message: "Invalid order ID." });
    }
    const result = normalizeShippingDetails(body.shipping);
    if (result.error) {
        return res.status(400).json({ success: false, message: result.error });
    }

    try {
        const order = await orderModel.findById(body.orderId);
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });
        if (["Shipped", "Out for delivery", "Delivered"].includes(order.status) &&
            !hasDispatchDetails(result.shipping)) {
            return res.status(409).json({
                success: false,
                message: "Shipped orders must retain the courier name and tracking number."
            });
        }
        order.shipping = {
            ...order.shipping.toObject(),
            ...result.shipping,
            ...(order.shipping.dispatchDate ? { dispatchDate: order.shipping.dispatchDate } : {})
        };
        await order.save();
        return res.json({ success: true, message: "Shipping details updated." });
    } catch (error) {
        console.error("Shipping details update failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to update shipping details." });
    }
};

// Explicit, audited resolution of a payment review. `release` re-acquires stock atomically before an order
// can be fulfilled; `acknowledge` clears a review that does not affect stock. Neither refunds anything.
const resolvePaymentReview = async (req, res) => {
    const { orderId, action } = req.body || {};
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!mongoose.Types.ObjectId.isValid(orderId) || !["release", "acknowledge"].includes(action)) {
        return res.status(400).json({ success: false, code: "INVALID_REQUEST", message: "Invalid order or review action." });
    }
    if (reason.length < 5 || reason.length > 120 || /[\u0000-\u001f\u007f]/.test(reason)) {
        return res.status(400).json({
            success: false,
            code: "REASON_REQUIRED",
            message: "Enter a reason of 5 to 120 characters for this review decision."
        });
    }

    let session;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const order = await orderModel.findById(orderId).session(session);
            if (!order || order.paymentMethod !== "Razorpay") throw statusError("Order not found.", 404, "ORDER_NOT_FOUND");
            if (!order.fulfillmentHold && !order.paymentReviewRequired) {
                throw statusError("This order has no payment review pending.", 409, "NO_REVIEW_PENDING");
            }
            const reviewReason = effectiveReviewReason(order);
            const openMismatchCount = reviewReason === REVIEW_REASONS.PAYMENT_MISMATCH
                ? await paymentAnomalyModel.countDocuments({
                    orderId: String(order._id),
                    kind: "captured_payment_mismatch",
                    investigationStatus: { $ne: "resolved" }
                })
                : 0;
            const state = reviewState(order, { openMismatchCount });
            const decision = action === "release" ? state.release : state.acknowledge;
            if (!decision.allowed) throw statusError(decision.message, 409, decision.code);

            if (action === "release" && !await deductAvailableStock(order.items, session)) {
                throw statusError(
                    "Stock is still unavailable for this paid order. Receive stock first, or cancel the order.",
                    409,
                    "STOCK_UNAVAILABLE"
                );
            }
            order.fulfillmentHold = false;
            order.paymentReviewRequired = false;
            order.paymentReviewReason = "";
            order.statusHistory.push(historyEntry({
                kind: "payment",
                from: order.paymentStatus,
                to: order.paymentStatus,
                actor: "admin",
                note: `Review ${action === "release" ? "released" : "acknowledged"} (${reviewReason}): ${reason}`.slice(0, 200)
            }));
            await order.save({ session });
        });
        return res.json({ success: true, message: "Payment review recorded." });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ success: false, code: error.code, message: error.message });
        }
        console.error("Payment review update failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to update the payment review." });
    } finally {
        if (session) await session.endSession();
    }
};

const collectCod = async (req, res) => {
    const orderId = req.body?.orderId;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({ success: false, message: "Invalid order ID." });
    }
    try {
        const order = await orderModel.findById(orderId);
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });
        const result = markCodCollected(order, "admin");
        if (result.error) return res.status(409).json({ success: false, message: result.error });
        await order.save();
        return res.json({ success: true, message: "Cash collection recorded." });
    } catch (error) {
        console.error("COD collection update failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to record cash collection." });
    }
};

const orderNotifications = async (req, res) => {
    const orderId = req.body?.orderId;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({ success: false, message: "Invalid order ID." });
    }
    try {
        return res.json({ success: true, notifications: await notifications.listForOrder(orderId) });
    } catch (error) {
        console.error("Notification history failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to load notification history." });
    }
};

const retryNotification = async (req, res) => {
    const { notificationId, channel } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(notificationId) || typeof channel !== "string") {
        return res.status(400).json({ success: false, message: "Invalid notification or channel." });
    }
    try {
        const result = await notifications.retry(notificationId, channel);
        if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
        return res.json({ success: true, message: "Retry attempted.", outcome: result.outcome });
    } catch (error) {
        console.error("Notification retry failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to retry this notification." });
    }
};

export {
    allOrders,
    collectCod,
    orderNotifications,
    paymentUnavailable,
    placeOrder,
    quoteOrder,
    retryNotification,
    resolvePaymentReview,
    updateShipping,
    updateStatus,
    userOrders
};
