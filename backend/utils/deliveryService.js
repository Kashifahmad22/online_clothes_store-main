// Delivery serviceability. A result is "serviceable" or "not_serviceable" only when a configured courier provider
// said so. Without a provider the answer is always "manual_confirmation"; nothing is guessed or invented.

export const DELIVERY_STATUS = Object.freeze({
    SERVICEABLE: "serviceable",
    NOT_SERVICEABLE: "not_serviceable",
    MANUAL: "manual_confirmation",
    UNAVAILABLE: "unavailable"
});

export const PINCODE_PATTERN = /^[1-9]\d{5}$/;

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";
const TIMEOUT_MS = 5000;
const TOKEN_TTL_MS = 8 * 24 * 60 * 60 * 1000; // Shiprocket tokens last 10 days; refresh well before that.

const tokenCache = { token: "", expiresAt: 0 };
export const resetDeliveryTokenCache = () => { tokenCache.token = ""; tokenCache.expiresAt = 0; };

export const shiprocketConfig = (env = process.env) => {
    const email = env.SHIPROCKET_EMAIL?.trim();
    const password = env.SHIPROCKET_PASSWORD?.trim();
    const pickup = env.DELIVERY_PICKUP_PINCODE?.trim();
    if (env.DELIVERY_PROVIDER?.trim().toLowerCase() !== "shiprocket") return null;
    if (!email || !password || !PINCODE_PATTERN.test(pickup || "")) return null;
    const handling = Number(env.DELIVERY_HANDLING_DAYS);
    return {
        email,
        password,
        pickup,
        handlingDays: Number.isInteger(handling) && handling >= 0 && handling <= 14 ? handling : 0
    };
};

export const isProviderConfigured = (env = process.env) => shiprocketConfig(env) !== null;

const timed = async (fetchImpl, url, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fetchImpl(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
};

const login = async (config, fetchImpl, now) => {
    if (tokenCache.token && tokenCache.expiresAt > now) return tokenCache.token;
    const response = await timed(fetchImpl, `${SHIPROCKET_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: config.email, password: config.password })
    });
    if (!response.ok) throw new Error("provider_auth_failed");
    const body = await response.json();
    if (typeof body?.token !== "string" || !body.token) throw new Error("provider_auth_failed");
    tokenCache.token = body.token;
    tokenCache.expiresAt = now + TOKEN_TTL_MS;
    return body.token;
};

const parseEtd = value => {
    if (typeof value !== "string") return null;
    const parsed = new Date(`${value} 00:00:00 UTC`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const isoDay = date => date.toISOString().slice(0, 10);

// Earliest and latest courier estimate, plus the configured handling time. Never extrapolated beyond provider data.
export const summariseCouriers = (couriers, handlingDays, today = new Date()) => {
    const dates = couriers.map(courier => parseEtd(courier?.etd)).filter(Boolean);
    if (dates.length === 0) return null;
    const floor = addDays(new Date(`${isoDay(today)}T00:00:00Z`), handlingDays);
    const earliest = new Date(Math.min(...dates.map(date => date.getTime())));
    const latest = new Date(Math.max(...dates.map(date => date.getTime())));
    const clamp = date => addDays(date, handlingDays) < floor ? floor : addDays(date, handlingDays);
    return { from: isoDay(clamp(earliest)), to: isoDay(clamp(latest)) };
};

export const checkDelivery = async (pincode, { env = process.env, fetchImpl = globalThis.fetch, now = Date.now() } = {}) => {
    if (typeof pincode !== "string" || !PINCODE_PATTERN.test(pincode)) {
        return { status: "invalid", message: "Enter a valid 6-digit PIN code." };
    }
    const config = shiprocketConfig(env);
    if (!config) {
        return {
            status: DELIVERY_STATUS.MANUAL,
            pincode,
            source: "none",
            message: "We will confirm delivery availability and the estimated delivery date for this PIN code before dispatch."
        };
    }
    try {
        const token = await login(config, fetchImpl, now);
        const query = new URLSearchParams({
            pickup_postcode: config.pickup,
            delivery_postcode: pincode,
            cod: "1",
            weight: "0.5"
        });
        const response = await timed(fetchImpl, `${SHIPROCKET_BASE}/courier/serviceability/?${query}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (response.status === 401) {
            tokenCache.token = "";
            throw new Error("provider_auth_failed");
        }
        if (response.status === 404) {
            return { status: DELIVERY_STATUS.NOT_SERVICEABLE, pincode, source: "shiprocket", message: "Delivery is not available to this PIN code." };
        }
        if (!response.ok) throw new Error("provider_error");
        const body = await response.json();
        const couriers = body?.data?.available_courier_companies;
        if (!Array.isArray(couriers)) throw new Error("provider_incomplete");
        if (couriers.length === 0) {
            return { status: DELIVERY_STATUS.NOT_SERVICEABLE, pincode, source: "shiprocket", message: "Delivery is not available to this PIN code." };
        }
        const estimate = summariseCouriers(couriers, config.handlingDays, new Date(now));
        return {
            status: DELIVERY_STATUS.SERVICEABLE,
            pincode,
            source: "shiprocket",
            codAvailable: couriers.some(courier => Number(courier?.cod) === 1),
            ...(estimate ? { estimate } : {}),
            message: estimate
                ? "Estimated delivery from the courier. This is an estimate, not a guaranteed date."
                : "Delivery is available. The delivery date will be confirmed before dispatch."
        };
    } catch {
        return {
            status: DELIVERY_STATUS.UNAVAILABLE,
            pincode,
            source: "shiprocket",
            message: "We could not check delivery right now. Please try again shortly."
        };
    }
};
