import express from "express";
import {
    allOrders,
    collectCod,
    orderNotifications,
    paymentUnavailable,
    placeOrder,
    retryNotification,
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
import authUser from "../middleware/auth.js";

const orderRouter = express.Router();

orderRouter.post("/list", adminAuth, allOrders);
orderRouter.post("/status", adminAuth, updateStatus);
orderRouter.post("/shipping", adminAuth, updateShipping);
orderRouter.post("/cod-collected", adminAuth, collectCod);
orderRouter.post("/notifications", adminAuth, orderNotifications);
orderRouter.post("/notifications/retry", adminAuth, retryNotification);
orderRouter.post("/place", authUser, placeOrder);
orderRouter.post("/userorders", authUser, userOrders);

orderRouter.post("/stripe", paymentUnavailable);
orderRouter.post("/razorpay/webhook", razorpayWebhook);
orderRouter.post("/razorpay", authUser, createRazorpayOrder);
orderRouter.post("/razorpay/retry", authUser, retryRazorpayOrder);
orderRouter.post("/verifyStripe", paymentUnavailable);
orderRouter.post("/verifyRazorpay", authUser, verifyRazorpayPayment);

export default orderRouter;
