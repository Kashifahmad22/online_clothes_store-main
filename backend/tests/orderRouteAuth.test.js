import test from "node:test";
import assert from "node:assert/strict";
import orderRouter from "../routes/orderRoute.js";
import adminAuth from "../middleware/adminAuth.js";
import authUser from "../middleware/auth.js";

const middlewareFor = path => {
    const layer = orderRouter.stack.find(item => item.route?.path === path && item.route.methods.post);
    assert.ok(layer, `${path} must exist`);
    return layer.route.stack.map(item => item.handle);
};

test("order management and notification endpoints require admin authentication", () => {
    for (const path of ["/list", "/status", "/shipping", "/cod-collected", "/payment-review", "/refund", "/refund/sync", "/reconcile", "/reconcile/history", "/payment-review/detail", "/anomalies", "/anomalies/status", "/notifications", "/notifications/retry"]) {
        assert.equal(middlewareFor(path)[0], adminAuth, path);
    }
});

test("customer order endpoints require customer authentication, never the admin one", () => {
    for (const path of ["/place", "/userorders", "/razorpay", "/razorpay/retry", "/verifyRazorpay"]) {
        assert.equal(middlewareFor(path)[0], authUser, path);
    }
});

test("the Razorpay webhook is unauthenticated by token and relies on signature verification", () => {
    const handlers = middlewareFor("/razorpay/webhook");
    assert.equal(handlers.includes(adminAuth), false);
    assert.equal(handlers.includes(authUser), false);
});
