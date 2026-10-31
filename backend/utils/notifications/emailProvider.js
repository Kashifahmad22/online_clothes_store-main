export class DeliveryError extends Error {
    constructor(code, { temporary = false } = {}) {
        super(code);
        this.name = "DeliveryError";
        this.code = code;
        this.temporary = temporary;
    }
}

const NETWORK_CODES = new Set(["ETIMEDOUT", "ECONNECTION", "ECONNRESET", "ECONNREFUSED", "ESOCKET", "EDNS", "EAI_AGAIN"]);

export const classifySmtpError = error => {
    if (error instanceof DeliveryError) return error;
    const response = Number(error?.responseCode);
    if (response >= 400 && response < 500) return new DeliveryError(`smtp_${response}`, { temporary: true });
    if (response >= 500 && response < 600) return new DeliveryError(`smtp_${response}`);
    if (NETWORK_CODES.has(error?.code)) return new DeliveryError(`smtp_${String(error.code).toLowerCase()}`, { temporary: true });
    return new DeliveryError(`smtp_${String(error?.code || "error").toLowerCase().slice(0, 30)}`);
};

export const readEmailConfig = (env = process.env) => {
    const host = env.SMTP_HOST?.trim();
    const from = env.EMAIL_FROM?.trim();
    if (!host || !from) return null;
    const port = Number.parseInt(env.SMTP_PORT, 10) || 587;
    const secure = env.SMTP_SECURE ? env.SMTP_SECURE.trim().toLowerCase() === "true" : port === 465;
    const user = env.SMTP_USER?.trim();
    const pass = env.SMTP_PASS;
    return { host, port, secure, from, auth: user && pass ? { user, pass } : undefined };
};

export const createEmailProvider = ({ env = process.env, transportFactory } = {}) => {
    const config = readEmailConfig(env);
    let transport;
    return {
        name: "email",
        isConfigured: () => Boolean(config),
        async send({ to, subject, text, html }) {
            if (!config) throw new DeliveryError("not_configured");
            try {
                if (!transport) {
                    transport = transportFactory
                        ? transportFactory(config)
                        : (await import("nodemailer")).default.createTransport({
                            host: config.host,
                            port: config.port,
                            secure: config.secure,
                            auth: config.auth,
                            connectionTimeout: 10000,
                            greetingTimeout: 10000,
                            socketTimeout: 20000
                        });
                }
                const result = await transport.sendMail({ from: config.from, to, subject, text, html });
                return { messageId: typeof result?.messageId === "string" ? result.messageId.slice(0, 200) : "" };
            } catch (error) {
                throw classifySmtpError(error);
            }
        }
    };
};
