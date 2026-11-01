import { createRazorpayClient } from "./razorpayConfig.js";

// Single seam for the Razorpay SDK client so tests can substitute it and never reach the real API.
export const razorpayGateway = { client: () => createRazorpayClient() };

export const GATEWAY_TIMEOUT_MS = 10000;

// The SDK has no request timeout, so a hung connection would otherwise hold an admin request (and any
// transaction around it) open indefinitely.
export const withTimeout = (promise, ms = GATEWAY_TIMEOUT_MS) => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Razorpay request timed out."), { code: "GATEWAY_TIMEOUT" })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// "definitive": Razorpay answered and rejected the request, so nothing was created.
// "rate_limited": nothing was created but the caller should back off.
// "uncertain": timeout, network failure or 5xx - the request may or may not have been applied.
export const classifyGatewayError = error => {
    const status = Number(error?.statusCode ?? error?.status);
    if (status === 429) return "rate_limited";
    if (error?.code === "GATEWAY_TIMEOUT") return "uncertain";
    if (status >= 400 && status < 500) return "definitive";
    return "uncertain";
};

// Admin-safe description of a gateway rejection: no stack, no request data, bounded length.
export const safeGatewayMessage = error => {
    const text = String(error?.error?.description || error?.message || "Razorpay rejected the request.");
    return text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) || "Razorpay rejected the request.";
};
