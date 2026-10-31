import Razorpay from "razorpay";

export const getRazorpayTestConfig = (environment = process.env) => {
    const keyId = environment.RAZORPAY_KEY_ID?.trim();
    const keySecret = environment.RAZORPAY_KEY_SECRET?.trim();
    const webhookSecret = environment.RAZORPAY_WEBHOOK_SECRET?.trim();

    if (environment.RAZORPAY_MODE !== "test" ||
        !keyId?.startsWith("rzp_test_") ||
        !keySecret ||
        !webhookSecret) {
        return null;
    }

    return { keyId, keySecret, webhookSecret };
};

export const isRazorpayTestConfigured = (environment = process.env) =>
    getRazorpayTestConfig(environment) !== null;

export const createRazorpayClient = (environment = process.env) => {
    const config = getRazorpayTestConfig(environment);
    if (!config) {
        throw Object.assign(new Error("Razorpay test-mode configuration is incomplete."), { status: 503 });
    }
    return new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
};
