import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from "../../models/notificationEventModel.js";
import { buildEmail, buildWhatsappParams } from "./templates.js";
import { normalizeIndianMobile } from "./whatsappProvider.js";

export const MAX_ATTEMPTS = 5;
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
const LOCK_MS = 2 * 60_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const dedupeKeyFor = (orderId, type, suffix = "") =>
    `${orderId}:${type}${suffix ? `:${suffix}` : ""}`;

/**
 * Notification delivery is at-least-once and strictly best-effort: nothing here throws into order, payment
 * or admin flows. Event creation is idempotent through the unique dedupeKey; each channel is claimed
 * atomically before sending so concurrent workers cannot both send it.
 */
export const createNotificationService = ({
    store,
    loadOrder,
    loadSettings = async () => ({}),
    email,
    whatsapp,
    now = () => new Date(),
    logger = console,
    maxAttempts = MAX_ATTEMPTS,
    backoffMs = BACKOFF_MS
}) => {
    const providers = { email, whatsapp };

    // Empty string means "deliverable"; otherwise the reason this channel must be skipped for this order.
    const skipReasonFor = (channel, order) => {
        if (channel === "email") {
            return EMAIL_PATTERN.test(String(order.address?.email || "").trim()) ? "" : "no_recipient";
        }
        // Business-initiated WhatsApp requires consent recorded at checkout; orders without it are never messaged.
        if (order.whatsappOptIn !== true) return "no_opt_in";
        return normalizeIndianMobile(order.address?.phone) ? "" : "no_recipient";
    };

    const recipientFor = (channel, order) => skipReasonFor(channel, order)
        ? ""
        : channel === "email" ? String(order.address.email).trim() : normalizeIndianMobile(order.address.phone);

    /**
     * Transactional outbox write. When `session` is supplied the event is created in the caller's MongoDB
     * transaction, so the order change and its notification commit or roll back together. This only writes a
     * document; nothing is ever sent from here, so a transaction retry cannot send a message twice.
     */
    const enqueue = async (order, type, { suffix, session } = {}) => {
        if (!NOTIFICATION_TYPES.includes(type)) throw new Error(`Unknown notification type: ${type}`);
        const orderId = String(order._id);
        const channels = {};
        for (const channel of NOTIFICATION_CHANNELS) {
            const reason = skipReasonFor(channel, order);
            channels[channel] = reason
                ? { status: "skipped", attempts: 0, reason }
                : { status: "pending", attempts: 0, nextAttemptAt: null };
        }
        const created = await store.insertIfAbsent({
            orderId,
            type,
            dedupeKey: dedupeKeyFor(orderId, type, suffix),
            channels
        }, { session });
        return { created };
    };

    const failureUpdate = (channel, error, attempts) => {
        const code = String(error?.code || "delivery_error").slice(0, 60);
        const temporary = error?.temporary === true && attempts < maxAttempts;
        return temporary
            ? {
                status: "pending",
                attempts,
                lastAttemptAt: now(),
                nextAttemptAt: new Date(now().getTime() + backoffMs[Math.min(attempts - 1, backoffMs.length - 1)]),
                reason: code,
                lockedUntil: null
            }
            : { status: "failed", attempts, lastAttemptAt: now(), nextAttemptAt: null, reason: code, lockedUntil: null };
    };

    const buildMessage = async (channel, type, order) => {
        if (channel === "email") {
            const settings = await loadSettings();
            return buildEmail(type, order, settings);
        }
        return { params: buildWhatsappParams(type, order) };
    };

    const deliverChannel = async (event, channel) => {
        const state = event.channels?.[channel];
        const eventId = event._id;
        if (!state || state.status !== "pending") return "ignored";
        const provider = providers[channel];
        const unavailableReason = !provider?.isConfigured()
            ? "provider_not_configured"
            : channel === "whatsapp" && !provider.hasTemplate(event.type) ? "template_not_configured" : "";
        const claimed = await store.claim(eventId, channel, now(), new Date(now().getTime() + LOCK_MS));
        if (!claimed) return "ignored";
        if (unavailableReason) {
            await store.update(eventId, channel, { status: "skipped", reason: unavailableReason, lockedUntil: null });
            return "skipped";
        }
        const attempts = (state.attempts || 0) + 1;
        try {
            const order = await loadOrder(event.orderId);
            if (!order) throw Object.assign(new Error("order_missing"), { code: "order_missing" });
            const to = recipientFor(channel, order);
            // The approved WhatsApp template text cannot explain a late payment on a cancelled order, so it is not sent.
            if (channel === "whatsapp" && event.type === "payment_success" && order.status === "Cancelled") {
                await store.update(eventId, channel, { status: "skipped", reason: "order_cancelled", lockedUntil: null });
                return "skipped";
            }
            if (!to) {
                await store.update(eventId, channel, {
                    status: "skipped",
                    reason: skipReasonFor(channel, order) || "no_recipient",
                    lockedUntil: null
                });
                return "skipped";
            }
            const message = await buildMessage(channel, event.type, order);
            const result = await provider.send({ to, type: event.type, ...message });
            await store.update(eventId, channel, {
                status: "sent",
                attempts,
                sentAt: now(),
                lastAttemptAt: now(),
                nextAttemptAt: null,
                providerMessageId: result?.messageId || "",
                reason: "",
                lockedUntil: null
            });
            return "sent";
        } catch (error) {
            const update = failureUpdate(channel, error, attempts);
            try {
                await store.update(eventId, channel, update);
            } catch (storeError) {
                logger.error("Notification state update failed:", { name: storeError?.name || "Error" });
            }
            logger.error("Notification delivery failed:", { channel, type: event.type, code: update.reason });
            return update.status;
        }
    };

    const deliver = async event => {
        const results = await Promise.all(NOTIFICATION_CHANNELS.map(channel =>
            deliverChannel(event, channel).catch(error => {
                logger.error("Notification channel error:", { channel, name: error?.name || "Error" });
                return "error";
            })));
        return Object.fromEntries(NOTIFICATION_CHANNELS.map((channel, index) => [channel, results[index]]));
    };

    // Bounded drain: a restart can leave a backlog, but one tick must not run unbounded.
    const MAX_BATCHES_PER_RUN = 8;
    const dispatchDue = async (limit = 25) => {
        let handled = 0;
        try {
            for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
                const events = await store.findDue(now(), limit);
                for (const event of events) await deliver(event);
                handled += events.length;
                if (events.length < limit) break;
            }
        } catch (error) {
            logger.error("Notification dispatch failed:", { name: error?.name || "Error" });
        }
        return handled;
    };

    const retry = async (eventId, channel) => {
        if (!NOTIFICATION_CHANNELS.includes(channel)) return { ok: false, status: 400, message: "Unknown channel." };
        const event = await store.findById(eventId);
        if (!event) return { ok: false, status: 404, message: "Notification not found." };
        const reset = await store.reset(eventId, channel, now());
        if (!reset) {
            return { ok: false, status: 409, message: "Only failed or skipped notifications can be retried." };
        }
        const fresh = await store.findById(eventId);
        const outcome = await deliverChannel(fresh, channel).catch(() => "error");
        return { ok: true, outcome };
    };

    const listForOrder = async orderId => (await store.listForOrder(String(orderId))).map(event => ({
        _id: String(event._id),
        type: event.type,
        createdAt: event.createdAt,
        channels: Object.fromEntries(NOTIFICATION_CHANNELS.map(channel => {
            const state = event.channels?.[channel] || {};
            return [channel, {
                status: state.status,
                attempts: state.attempts || 0,
                reason: state.reason || "",
                sentAt: state.sentAt || null,
                lastAttemptAt: state.lastAttemptAt || null,
                nextAttemptAt: state.status === "pending" ? state.nextAttemptAt || null : null
            }];
        }))
    }));

    return { enqueue, deliver, dispatchDue, retry, listForOrder };
};
