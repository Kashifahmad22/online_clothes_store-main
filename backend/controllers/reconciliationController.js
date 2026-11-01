import { createHash, timingSafeEqual } from "node:crypto";
import { getRazorpayTestConfig } from "../utils/razorpayConfig.js";
import { reconcilePayments } from "../utils/paymentReconciliation.js";

const MIN_TOKEN_LENGTH = 32;
const digest = value => createHash("sha256").update(String(value)).digest();

const run = async (res, options) => {
    if (!getRazorpayTestConfig()) {
        return res.status(503).json({ success: false, code: "PAYMENTS_NOT_CONFIGURED", message: "Razorpay is not configured." });
    }
    try {
        const result = await reconcilePayments(options);
        if (!result.started) return res.status(409).json({ success: false, code: result.code, message: result.message });
        return res.json({ success: true, ...result });
    } catch (error) {
        console.error("Reconciliation failed:", error.message);
        return res.status(500).json({ success: false, message: "Reconciliation failed." });
    }
};

const OBJECT_ID = /^[a-f\d]{24}$/i;

// Admin-triggered run (also the controlled-recovery path when `orderId` targets a single order).
export const reconcileNow = (req, res) => {
    const { limit, windowHours, orderId } = req.body || {};
    if (orderId !== undefined && (typeof orderId !== "string" || !OBJECT_ID.test(orderId))) {
        return res.status(400).json({ success: false, code: "INVALID_ORDER", message: "A valid order is required." });
    }
    return run(res, { trigger: "admin", actor: "admin", limit, windowHours, orderId });
};

// For an external scheduler. Disabled (503) until RECONCILIATION_JOB_TOKEN is configured, and the token must be
// long enough to resist guessing. The comparison is constant-time over fixed-length digests.
export const reconcileScheduled = (req, res) => {
    const expected = process.env.RECONCILIATION_JOB_TOKEN;
    if (typeof expected !== "string" || expected.length < MIN_TOKEN_LENGTH) {
        return res.status(503).json({ success: false, code: "SCHEDULER_NOT_CONFIGURED", message: "Scheduled reconciliation is not configured." });
    }
    const supplied = req.headers["x-reconcile-token"];
    if (typeof supplied !== "string" || !timingSafeEqual(digest(supplied), digest(expected))) {
        return res.status(401).json({ success: false, message: "Not authorized." });
    }
    const { limit, windowHours } = req.body || {};
    return run(res, { trigger: "scheduled", actor: "scheduler", limit, windowHours });
};
