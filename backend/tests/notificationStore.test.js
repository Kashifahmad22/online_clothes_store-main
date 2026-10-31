import assert from "node:assert/strict";
import test from "node:test";
import notificationEventModel from "../models/notificationEventModel.js";
import { createMongoNotificationStore, startNotificationWorker } from "../utils/notifications/index.js";
import { createNotificationService } from "../utils/notifications/notificationService.js";
import { DeliveryError } from "../utils/notifications/emailProvider.js";

// NOTE: this is an in-memory double of the Mongoose model. It verifies the store's query shapes and the service
// logic on top of them. It does NOT prove real MongoDB atomicity, transactions or index enforcement.

const quiet = { error() {}, warn() {}, log() {} };

const getPath = (doc, path) => path.split(".").reduce((value, key) => value?.[key], doc);
const setPath = (doc, path, value) => {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce((node, key) => (node[key] ??= {}), doc);
    target[last] = value;
};

const matches = (doc, filter) => Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return condition.some(part => matches(doc, part));
    if (key === "$and") return condition.every(part => matches(doc, part));
    const value = getPath(doc, key);
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
        return Object.entries(condition).every(([op, operand]) => {
            if (op === "$lte") return value != null && value <= operand;
            if (op === "$lt") return value != null && value < operand;
            if (op === "$in") return operand.includes(value);
            throw new Error(`unsupported operator ${op}`);
        });
    }
    // Mongo equality with null also matches missing fields.
    return condition === null ? value == null : value === condition;
});

const createModelDouble = ({ failWith } = {}) => {
    const docs = [];
    let ids = 0;
    const guard = () => { if (failWith) throw failWith; };
    return {
        docs,
        async updateOne(filter, update, options = {}) {
            guard();
            await Promise.resolve();
            const found = docs.find(doc => matches(doc, filter));
            if (!found) {
                if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
                if (docs.some(doc => doc.dedupeKey === update.$setOnInsert?.dedupeKey)) {
                    throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
                }
                ids += 1;
                docs.push({ ...structuredClone(update.$setOnInsert), _id: `evt${ids}`, createdAt: new Date(ids) });
                return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
            }
            for (const [path, value] of Object.entries(update.$set || {})) setPath(found, path, value);
            return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        },
        findById(id) {
            guard();
            return { lean: async () => docs.find(doc => doc._id === id) || null };
        },
        find(filter) {
            guard();
            let rows = docs.filter(doc => matches(doc, filter));
            const query = {
                sort() { return query; },
                limit(count) { rows = rows.slice(0, count); return query; },
                lean: async () => rows.map(row => structuredClone(row))
            };
            return query;
        }
    };
};

const order = {
    _id: "665f1c2e8f1b2c0012345678",
    paymentMethod: "COD",
    whatsappOptIn: true,
    paymentStatus: "cod_pending",
    status: "Order Placed",
    totalPaise: 250000,
    address: { firstName: "Asha", email: "asha@example.com", phone: "9876543210" },
    items: [{ name: "Silk Saree", quantity: 1, unitPricePaise: 250000 }],
    shipping: {}
};

const provider = (behaviour = async () => ({ messageId: "ok" })) => {
    const sent = [];
    return { sent, isConfigured: () => true, hasTemplate: () => true,
        async send(message) { const result = await behaviour(message, sent.length); sent.push(message); return result; } };
};

const buildService = (model, { email = provider(), whatsapp = provider(), clock = { value: 1_700_000_000_000 } } = {}) => ({
    clock,
    email,
    whatsapp,
    store: createMongoNotificationStore(model),
    service: createNotificationService({
        store: createMongoNotificationStore(model), loadOrder: async () => order, email, whatsapp,
        now: () => new Date(clock.value), logger: quiet
    })
});

test("the outbox upsert is issued with the caller's transaction session", async () => {
    const calls = [];
    const model = { async updateOne(filter, update, options) { calls.push(options); return { upsertedCount: 1 }; } };
    const store = createMongoNotificationStore(model);
    const session = { id: "txn-session" };
    await store.insertIfAbsent({ dedupeKey: "k" }, { session });
    await store.insertIfAbsent({ dedupeKey: "k2" });
    assert.equal(calls[0].session, session);
    assert.equal(calls[0].upsert, true);
    assert.equal("session" in calls[1], false);
});

test("the order model makes WhatsApp consent immutable and false by default", async () => {
    const { default: orderModel } = await import("../models/orderModel.js");
    assert.equal(orderModel.schema.path("whatsappOptIn").options.immutable, true);
    assert.equal(orderModel.schema.path("whatsappOptIn").options.default, false);
    assert.equal(orderModel.schema.path("whatsappOptInAt").options.immutable, true);
});

test("the event schema enforces a unique dedupeKey index", () => {
    assert.equal(notificationEventModel.schema.path("dedupeKey").options.unique, true);
});

test("concurrent creation with the same dedupe key yields exactly one event", async () => {
    const model = createModelDouble();
    const { service } = buildService(model);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.enqueue(order, "order_placed")));
    assert.equal(model.docs.length, 1);
    assert.equal(results.filter(result => result.status === "fulfilled" && result.value.created).length, 1);
});

test("channel claims are exclusive: of two concurrent claims only one wins", async () => {
    const model = createModelDouble();
    const { service, store } = buildService(model);
    await service.enqueue(order, "order_placed");
    const now = new Date();
    const lock = new Date(now.getTime() + 120_000);
    const wins = await Promise.all([
        store.claim("evt1", "email", now, lock),
        store.claim("evt1", "email", now, lock)
    ]);
    assert.equal(wins.filter(Boolean).length, 1);
});

test("an unexpired lock blocks claims and an expired lock can be reclaimed", async () => {
    const model = createModelDouble();
    const { service, store } = buildService(model);
    await service.enqueue(order, "order_placed");
    const now = new Date(1_700_000_000_000);
    assert.equal(await store.claim("evt1", "email", now, new Date(now.getTime() + 120_000)), true);
    assert.equal(await store.claim("evt1", "email", new Date(now.getTime() + 60_000), new Date(now.getTime() + 180_000)), false);
    assert.equal(await store.claim("evt1", "email", new Date(now.getTime() + 121_000), new Date(now.getTime() + 241_000)), true);
});

test("restart: a fresh service and worker deliver events left pending in the database", async () => {
    const model = createModelDouble();
    const first = buildService(model);
    await first.service.enqueue(order, "order_placed");
    assert.equal(first.email.sent.length, 0);

    // A brand-new process: new service, new providers, same persisted data.
    const second = buildService(model, { clock: first.clock });
    const worker = startNotificationWorker({ dispatch: () => second.service.dispatchDue(), intervalMs: 3_600_000, logger: quiet });
    await worker.initial;
    worker.stop();
    assert.equal(second.email.sent.length, 1);
    assert.equal(second.whatsapp.sent.length, 1);
    assert.equal(model.docs[0].channels.email.status, "sent");
    assert.equal(model.docs[0].channels.whatsapp.status, "sent");
});

test("a completed event is never sent again", async () => {
    const model = createModelDouble();
    const { service, email, whatsapp } = buildService(model);
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    await service.dispatchDue();
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    assert.equal(email.sent.length, 1);
    assert.equal(whatsapp.sent.length, 1);
});

test("a temporary provider failure retries after backoff, and the other channel is unaffected", async () => {
    const model = createModelDouble();
    let calls = 0;
    const email = provider(async () => {
        calls += 1;
        if (calls === 1) throw new DeliveryError("temporary", { temporary: true });
        return { messageId: "later" };
    });
    const { service, clock } = buildService(model, { email });
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    const [event] = model.docs;
    assert.equal(event.channels.whatsapp.status, "sent");
    assert.equal(event.channels.email.status, "pending");
    assert.equal(event.channels.email.attempts, 1);

    await service.dispatchDue();
    assert.equal(model.docs[0].channels.email.status, "pending", "not retried before backoff elapses");

    clock.value += 61_000;
    await service.dispatchDue();
    assert.equal(model.docs[0].channels.email.status, "sent");
    assert.equal(model.docs[0].channels.whatsapp.status, "sent");
});

test("a permanent failure ends as failed without retrying", async () => {
    const model = createModelDouble();
    const email = provider(async () => { throw new DeliveryError("rejected", { temporary: false }); });
    const { service, clock } = buildService(model, { email });
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    clock.value += 24 * 3_600_000;
    await service.dispatchDue();
    assert.equal(model.docs[0].channels.email.status, "failed");
    assert.equal(model.docs[0].channels.email.attempts, 1);
});

test("an admin reset makes a failed channel retryable from zero attempts", async () => {
    const model = createModelDouble();
    const email = provider(async () => { throw new DeliveryError("rejected", { temporary: false }); });
    const { service, store } = buildService(model, { email });
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    assert.equal(await store.reset("evt1", "email"), true);
    assert.equal(model.docs[0].channels.email.attempts, 0);
    assert.equal(model.docs[0].channels.email.status, "pending");
    assert.equal(await store.reset("evt1", "whatsapp"), false, "sent channels cannot be reset");
});

test("a MongoDB failure never throws out of dispatch or the worker", async () => {
    const model = createModelDouble({ failWith: new Error("mongo down") });
    const { service } = buildService(model);
    assert.equal(await service.dispatchDue(), 0);
    const worker = startNotificationWorker({ dispatch: () => service.dispatchDue(), intervalMs: 3_600_000, logger: quiet });
    assert.equal(await worker.initial, 0);
    worker.stop();
});

test("an outbox write failure propagates so the surrounding transaction can abort", async () => {
    const model = createModelDouble({ failWith: new Error("mongo down") });
    const { service } = buildService(model);
    await assert.rejects(() => service.enqueue(order, "order_placed", { session: {} }), /mongo down/);
});

test("the worker never overlaps ticks and survives dispatch errors", async () => {
    let calls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const worker = startNotificationWorker({
        dispatch: async () => { calls += 1; await gate; return 1; },
        intervalMs: 3_600_000,
        logger: quiet
    });
    assert.equal(await worker.tick(), 0, "overlapping tick is skipped");
    release();
    await worker.initial;
    worker.stop();
    assert.equal(calls, 1);

    const failing = startNotificationWorker({ dispatch: async () => { throw new Error("boom"); }, intervalMs: 3_600_000, logger: quiet });
    assert.equal(await failing.initial, 0);
    failing.stop();
});
