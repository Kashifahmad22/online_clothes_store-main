import notificationEventModel from "../../models/notificationEventModel.js";
import orderModel from "../../models/orderModel.js";
import storefrontSettingsModel from "../../models/storefrontSettingsModel.js";
import { getSiteUrl } from "../siteUrl.js";
import { createEmailProvider } from "./emailProvider.js";
import { createWhatsappProvider } from "./whatsappProvider.js";
import { createNotificationService } from "./notificationService.js";

const due = (channel, now) => ({
    [`channels.${channel}.status`]: "pending",
    $or: [
        { [`channels.${channel}.nextAttemptAt`]: null },
        { [`channels.${channel}.nextAttemptAt`]: { $lte: now } }
    ]
});

// A lock only blocks other workers while it is unexpired, so a crashed worker's claim is recoverable.
const unlocked = (channel, now) => ({
    $or: [
        { [`channels.${channel}.lockedUntil`]: null },
        { [`channels.${channel}.lockedUntil`]: { $lt: now } }
    ]
});

const claimable = (channel, now) => ({ $and: [due(channel, now), unlocked(channel, now)] });

export const createMongoNotificationStore = (Model = notificationEventModel) => ({
    async insertIfAbsent(doc, { session } = {}) {
        // An upsert keyed on the unique dedupeKey never creates a second event for the same key.
        const result = await Model.updateOne(
            { dedupeKey: doc.dedupeKey },
            { $setOnInsert: doc },
            { upsert: true, ...(session ? { session } : {}) }
        );
        return result.upsertedCount === 1;
    },
    findById: id => Model.findById(id).lean(),
    findDue: (now, limit) => Model.find({ $or: [claimable("email", now), claimable("whatsapp", now)] })
        .sort({ createdAt: 1 }).limit(limit).lean(),
    async claim(id, channel, now, lockUntil) {
        const path = `channels.${channel}`;
        const result = await Model.updateOne(
            { _id: id, ...claimable(channel, now) },
            { $set: { [`${path}.lockedUntil`]: lockUntil } }
        );
        return result.modifiedCount === 1;
    },
    async update(id, channel, fields) {
        const set = Object.fromEntries(Object.entries(fields).map(([key, value]) => [`channels.${channel}.${key}`, value]));
        await Model.updateOne({ _id: id }, { $set: set });
    },
    async reset(id, channel) {
        const path = `channels.${channel}`;
        const result = await Model.updateOne({
            _id: id,
            [`${path}.status`]: { $in: ["failed", "skipped"] }
        }, {
            $set: {
                [`${path}.status`]: "pending",
                [`${path}.attempts`]: 0,
                [`${path}.nextAttemptAt`]: null,
                [`${path}.lockedUntil`]: null,
                [`${path}.reason`]: ""
            }
        });
        return result.modifiedCount === 1;
    },
    listForOrder: orderId => Model.find({ orderId }).sort({ createdAt: 1 }).lean()
});

const loadSettings = async () => {
    const settings = await storefrontSettingsModel.findOne({ key: "primary" }).lean().catch(() => null);
    return {
        brandName: settings?.brand?.publicName || undefined,
        support: settings?.support || {},
        siteUrl: getSiteUrl()
    };
};

export const notifications = createNotificationService({
    store: createMongoNotificationStore(),
    loadOrder: id => orderModel.findById(id).lean(),
    loadSettings,
    email: createEmailProvider(),
    whatsapp: createWhatsappProvider()
});

// Post-commit nudge only. The outbox event is already durable, so if this never runs the worker still delivers it.
export const dispatchNotifications = () => {
    setImmediate(() => { notifications.dispatchDue().catch(() => {}); });
};

/**
 * Stages a notification inside the caller's MongoDB transaction (the outbox write). Errors deliberately
 * propagate: if the event cannot be written, the transaction aborts as a whole rather than committing an order
 * whose notification would be lost. This is a database write only; provider failures can never reach it.
 */
export const stageNotification = (order, type, { session, suffix } = {}) =>
    notifications.enqueue(order, type, { session, suffix });

/**
 * Background outbox worker. It scans MongoDB for pending, due, unlocked channels, so events left behind by a
 * crash or restart are discovered on the first tick without any in-memory state.
 */
export const startNotificationWorker = ({
    dispatch = () => notifications.dispatchDue(),
    intervalMs = 60 * 1000,
    logger = console
} = {}) => {
    let running = false;
    const tick = async () => {
        if (running) return 0;
        running = true;
        try {
            return await dispatch();
        } catch (error) {
            logger.error("Notification worker tick failed:", { name: error?.name || "Error" });
            return 0;
        } finally {
            running = false;
        }
    };
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    const initial = tick();
    return { tick, initial, stop: () => clearInterval(timer) };
};
