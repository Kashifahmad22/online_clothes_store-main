import { DeliveryError } from "./emailProvider.js";

const TEMPLATE_ENV = {
    order_placed: "WHATSAPP_TEMPLATE_ORDER_PLACED",
    payment_success: "WHATSAPP_TEMPLATE_PAYMENT_SUCCESS",
    order_dispatched: "WHATSAPP_TEMPLATE_ORDER_DISPATCHED",
    out_for_delivery: "WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY",
    order_delivered: "WHATSAPP_TEMPLATE_ORDER_DELIVERED",
    return_approved: "WHATSAPP_TEMPLATE_RETURN_APPROVED",
    refund_processed: "WHATSAPP_TEMPLATE_REFUND_PROCESSED"
};

export const WHATSAPP_TEMPLATE_ENV = Object.freeze({ ...TEMPLATE_ENV });

export const readWhatsappConfig = (env = process.env) => {
    const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    if (!accessToken || !phoneNumberId || !/^\d{5,25}$/.test(phoneNumberId)) return null;
    const apiVersion = env.WHATSAPP_API_VERSION?.trim() || "v20.0";
    if (!/^v\d{1,2}\.\d$/.test(apiVersion)) return null;
    const templates = {};
    for (const [type, name] of Object.entries(TEMPLATE_ENV)) {
        const value = env[name]?.trim();
        if (value && /^[a-z0-9_]{1,512}$/.test(value)) templates[type] = value;
    }
    return {
        accessToken,
        phoneNumberId,
        apiVersion,
        language: env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en",
        templates
    };
};

// Indian mobile numbers are validated at checkout; returns digits with the country code, or "" when unusable.
export const normalizeIndianMobile = value => {
    const digits = String(value ?? "").replace(/[\s()-]/g, "");
    const match = digits.match(/^(?:\+?91)?([6-9]\d{9})$/);
    return match ? `91${match[1]}` : "";
};

// Meta rejects template parameters that contain newlines, tabs or runs of spaces.
const sanitizeParam = value => String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 1024) || "-";

export const createWhatsappProvider = ({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) => {
    const config = readWhatsappConfig(env);
    return {
        name: "whatsapp",
        isConfigured: () => Boolean(config),
        hasTemplate: type => Boolean(config?.templates[type]),
        async send({ to, type, params }) {
            if (!config) throw new DeliveryError("not_configured");
            const template = config.templates[type];
            if (!template) throw new DeliveryError("template_not_configured");
            let response;
            try {
                response = await fetchImpl(
                    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${config.accessToken}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            messaging_product: "whatsapp",
                            to,
                            type: "template",
                            template: {
                                name: template,
                                language: { code: config.language },
                                components: [{
                                    type: "body",
                                    parameters: params.map(text => ({ type: "text", text: sanitizeParam(text) }))
                                }]
                            }
                        }),
                        signal: AbortSignal.timeout(timeoutMs)
                    }
                );
            } catch {
                throw new DeliveryError("whatsapp_network", { temporary: true });
            }
            if (response.ok) {
                const body = await response.json().catch(() => ({}));
                const messageId = body?.messages?.[0]?.id;
                return { messageId: typeof messageId === "string" ? messageId.slice(0, 200) : "" };
            }
            const body = await response.json().catch(() => ({}));
            const metaCode = Number.isInteger(body?.error?.code) ? `_${body.error.code}` : "";
            const temporary = response.status === 429 || response.status >= 500;
            throw new DeliveryError(`whatsapp_http_${response.status}${metaCode}`, { temporary });
        }
    };
};
