import express from "express";
import {
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
} from "../controllers/orderController.js";
import {
    createRazorpayOrder,
    razorpayWebhook,
    retryRazorpayOrder,
    verifyRazorpayPayment
} from "../controllers/razorpayController.js";
import adminAuth from "../middleware/adminAuth.js";
import { initiateRefund, syncRefunds } from "../controllers/refundController.js";
import {
    listAnomalies,
    paymentReviewDetail,
    reconciliationHistory,
    setAnomalyStatus
} from "../controllers/anomalyController.js";
import { reconcileNow, reconcileScheduled } from "../controllers/reconciliationController.js";
import authUser from "../middleware/auth.js";

const orderRouter = express.Router();

orderRouter.post("/list", adminAuth, allOrders);
orderRouter.post("/status", adminAuth, updateStatus);
orderRouter.post("/shipping", adminAuth, updateShipping);
orderRouter.post("/cod-collected", adminAuth, collectCod);
orderRouter.post("/payment-review", adminAuth, resolvePaymentReview);
orderRouter.post("/refund", adminAuth, initiateRefund);
orderRouter.post("/refund/sync", adminAuth, syncRefunds);
orderRouter.post("/reconcile", adminAuth, reconcileNow);
orderRouter.post("/reconcile/history", adminAuth, reconciliationHistory);
orderRouter.post("/payment-review/detail", adminAuth, paymentReviewDetail);
orderRouter.post("/anomalies", adminAuth, listAnomalies);
orderRouter.post("/anomalies/status", adminAuth, setAnomalyStatus);
// Authenticated by the x-reconcile-token header instead of an admin session; disabled until the token env var is set.
orderRouter.post("/reconcile/scheduled", reconcileScheduled);
orderRouter.post("/notifications", adminAuth, orderNotifications);
orderRouter.post("/notifications/retry", adminAuth, retryNotification);
orderRouter.post("/place", authUser, placeOrder);
orderRouter.post("/quote", authUser, quoteOrder);
orderRouter.post("/userorders", authUser, userOrders);

orderRouter.post("/stripe", paymentUnavailable);
orderRouter.post("/razorpay/webhook", razorpayWebhook);
orderRouter.post("/razorpay", authUser, createRazorpayOrder);
orderRouter.post("/razorpay/retry", authUser, retryRazorpayOrder);
orderRouter.post("/verifyStripe", paymentUnavailable);
orderRouter.post("/verifyRazorpay", authUser, verifyRazorpayPayment);

export default orderRouter;
