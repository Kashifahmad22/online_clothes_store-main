import test from "node:test";
import assert from "node:assert/strict";
import { createNotificationService } from "../utils/notifications/notificationService.js";
import { DeliveryError, createEmailProvider } from "../utils/notifications/emailProvider.js";
import { createWhatsappProvider, normalizeIndianMobile } from "../utils/notifications/whatsappProvider.js";
import { buildEmail } from "../utils/notifications/templates.js";

const quiet = { error() {}, warn() {}, log() {} };

const createFakeStore = () => {
    const events = new Map();
    let sequence = 0;
    return {
        events,
        async insertIfAbsent(doc) {
            if ([...events.values()].some(event => event.dedupeKey === doc.dedupeKey)) return false;
            sequence += 1;
            events.set(String(sequence), { ...structuredClone(doc), _id: String(sequence), createdAt: new Date() });
            return true;
        },
        async findById(id) { return events.get(String(id)) || null; },
        async findDue(now, limit) {
            return [...events.values()].filter(event => ["email", "whatsapp"].some(channel => {
                const state = event.channels[channel];
                return state.status === "pending" && (!state.nextAttemptAt || state.nextAttemptAt <= now) &&
                    (!state.lockedUntil || state.lockedUntil <= now);
            })).slice(0, limit);
        },
        async claim(id, channel, now, lockedUntil) {
            const state = events.get(String(id))?.channels[channel];
            if (!state || state.status !== "pending" || (state.lockedUntil && state.lockedUntil > now) ||
                (state.nextAttemptAt && state.nextAttemptAt > now)) return false;
            state.lockedUntil = lockedUntil;
            return true;
        },
        async update(id, channel, patch) { Object.assign(events.get(String(id)).channels[channel], patch); },
        async reset(id, channel) {
            const state = events.get(String(id))?.channels[channel];
            if (!state || !["failed", "skipped"].includes(state.status)) return false;
            Object.assign(state, { status: "pending", attempts: 0, nextAttemptAt: null, lockedUntil: null, reason: "" });
            return true;
        },
        async listForOrder(orderId) { return [...events.values()].filter(event => event.orderId === orderId); }
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

const okProvider = (extra = {}) => {
    const sent = [];
    return { sent, isConfigured: () => true, hasTemplate: () => true,
        async send(message) { sent.push(message); return { messageId: `id-${sent.length}` }; }, ...extra };
};

const build = (overrides = {}) => {
    const store = createFakeStore();
    let clock = 1_700_000_000_000;
    const service = createNotificationService({
        store, loadOrder: async () => order, email: okProvider(), whatsapp: okProvider(),
        now: () => new Date(clock), logger: quiet, ...overrides
    });
    return { store, service, advance: ms => { clock += ms; } };
};

test("an event is created once per order, type and suffix, so repeats never duplicate", async () => {
    const { service, store } = build();
    assert.equal((await service.enqueue(order, "order_placed")).created, true);
    assert.equal((await service.enqueue(order, "order_placed")).created, false);
    assert.equal((await service.enqueue(order, "refund_processed", { suffix: "rfnd_1" })).created, true);
    assert.equal((await service.enqueue(order, "refund_processed", { suffix: "rfnd_2" })).created, true);
    assert.equal(store.events.size, 3);
});

test("repeated dispatch sends each channel exactly once", async () => {
    const email = okProvider();
    const whatsapp = okProvider();
    const { service } = build({ email, whatsapp });
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    await service.dispatchDue();
    assert.equal(email.sent.length, 1);
    assert.equal(whatsapp.sent.length, 1);
});

test("an unconfigured email provider is skipped without affecting WhatsApp", async () => {
    const email = okProvider({ isConfigured: () => false });
    const whatsapp = okProvider();
    const { service, store } = build({ email, whatsapp });
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    const [event] = [...store.events.values()];
    assert.equal(event.channels.email.status, "skipped");
    assert.equal(event.channels.email.reason, "provider_not_configured");
    assert.equal(event.channels.whatsapp.status, "sent");
});

test("an unconfigured WhatsApp provider or missing template is skipped without affecting email", async () => {
    const { service, store } = build({
        whatsapp: okProvider({ hasTemplate: () => false })
    });
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    const [event] = [...store.events.values()];
    assert.equal(event.channels.whatsapp.reason, "template_not_configured");
    assert.equal(event.channels.email.status, "sent");
});

test("WhatsApp is never sent without recorded opt-in, while email is unaffected", async () => {
    const email = okProvider();
    const whatsapp = okProvider();
    const { service, store } = build({ email, whatsapp });
    await service.enqueue({ ...order, whatsappOptIn: false }, "order_placed");
    await service.enqueue({ ...order, _id: "665f1c2e8f1b2c0012345679", whatsappOptIn: undefined }, "order_placed");
    await service.dispatchDue();
    assert.equal(whatsapp.sent.length, 0);
    assert.equal(email.sent.length, 2);
    for (const event of store.events.values()) {
        assert.equal(event.channels.whatsapp.status, "skipped");
        assert.equal(event.channels.whatsapp.reason, "no_opt_in");
    }
});

test("an admin retry cannot bypass the consent check", async () => {
    const whatsapp = okProvider();
    const { service, store } = build({ whatsapp, loadOrder: async () => ({ ...order, whatsappOptIn: false }) });
    await service.enqueue({ ...order, whatsappOptIn: false }, "order_placed");
    const [event] = [...store.events.values()];
    const outcome = await service.retry(event._id, "whatsapp");
    assert.equal(outcome.outcome, "skipped");
    assert.equal(whatsapp.sent.length, 0);
    assert.equal(event.channels.whatsapp.reason, "no_opt_in");
});

test("a late payment on a cancelled order is never sent as a WhatsApp template and the email says so honestly", async () => {
    const cancelled = { ...order, status: "Cancelled", paymentMethod: "Razorpay", paymentStatus: "paid", fulfillmentHold: true };
    const email = okProvider();
    const whatsapp = okProvider();
    const { service, store } = build({ email, whatsapp, loadOrder: async () => cancelled });
    await service.enqueue(cancelled, "payment_success");
    await service.dispatchDue();
    const [event] = [...store.events.values()];
    assert.equal(event.channels.whatsapp.reason, "order_cancelled");
    assert.equal(whatsapp.sent.length, 0);
    assert.equal(email.sent.length, 1);
    assert.match(email.sent[0].text, /after this order was cancelled/);
    assert.doesNotMatch(email.sent[0].text, /confirmed/);
});

test("a channel without a valid recipient is skipped at enqueue time", async () => {
    const { service, store } = build();
    await service.enqueue({ ...order, address: { firstName: "A", email: "bad", phone: "123" } }, "order_placed");
    const [event] = [...store.events.values()];
    assert.equal(event.channels.email.reason, "no_recipient");
    assert.equal(event.channels.whatsapp.reason, "no_recipient");
});

test("temporary failures back off and retry, then succeed; one channel failing never blocks the other", async () => {
    let calls = 0;
    const email = okProvider({
        async send() {
            calls += 1;
            if (calls === 1) throw new DeliveryError("smtp_timeout", { temporary: true });
            return { messageId: "ok" };
        }
    });
    const { service, store, advance } = build({ email });
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    const [event] = [...store.events.values()];
    assert.equal(event.channels.email.status, "pending");
    assert.equal(event.channels.email.attempts, 1);
    assert.equal(event.channels.whatsapp.status, "sent");
    await service.dispatchDue();
    assert.equal(calls, 1, "must wait for backoff");
    advance(61_000);
    await service.dispatchDue();
    assert.equal(event.channels.email.status, "sent");
    assert.equal(calls, 2);
});

test("permanent failures and exhausted attempts end as failed and store only an error code", async () => {
    const permanent = okProvider({ async send() { throw new DeliveryError("smtp_rejected", { temporary: false }); } });
    const first = build({ email: permanent });
    await first.service.enqueue(order, "order_placed");
    await first.service.dispatchDue();
    const [event] = [...first.store.events.values()];
    assert.equal(event.channels.email.status, "failed");
    assert.equal(event.channels.email.reason, "smtp_rejected");

    const flaky = okProvider({ async send() { throw new DeliveryError("smtp_timeout", { temporary: true }); } });
    const second = build({ email: flaky, maxAttempts: 2, backoffMs: [10, 10] });
    await second.service.enqueue(order, "order_placed");
    await second.service.dispatchDue();
    second.advance(100);
    await second.service.dispatchDue();
    assert.equal([...second.store.events.values()][0].channels.email.status, "failed");
});

test("a provider that throws unexpectedly never escapes the service", async () => {
    const email = okProvider({ async send() { throw new Error("boom with secret token abc"); } });
    const { service, store } = build({ email });
    await service.enqueue(order, "order_placed");
    await assert.doesNotReject(() => service.dispatchDue());
    const [event] = [...store.events.values()];
    assert.equal(event.channels.email.status, "failed");
    assert.equal(JSON.stringify(event).includes("secret token"), false);
});

test("admin retry resets only failed or skipped channels and redelivers", async () => {
    let configured = false;
    const email = okProvider({ isConfigured: () => configured });
    const { service, store } = build({ email });
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    const [event] = [...store.events.values()];
    assert.equal(event.channels.email.status, "skipped");
    configured = true;
    assert.deepEqual(await service.retry(event._id, "email"), { ok: true, outcome: "sent" });
    assert.equal((await service.retry(event._id, "email")).status, 409);
    assert.equal((await service.retry(event._id, "sms")).status, 400);
    assert.equal((await service.retry("missing", "email")).status, 404);
    assert.equal(email.sent.length, 1);
});

test("concurrent workers cannot both send the same channel", async () => {
    const email = okProvider();
    const { service, store } = build({ email });
    await service.enqueue(order, "order_placed");
    const [event] = [...store.events.values()];
    await Promise.all([service.deliver(event), service.deliver(event)]);
    assert.equal(email.sent.length, 1);
});

test("the admin history view exposes statuses but no addresses, phones or message bodies", async () => {
    const { service } = build();
    await service.enqueue(order, "order_placed");
    await service.dispatchDue();
    const serialized = JSON.stringify(await service.listForOrder(order._id));
    assert.equal(serialized.includes("asha@example.com"), false);
    assert.equal(serialized.includes("9876543210"), false);
    assert.match(serialized, /"status":"sent"/);
});

test("email provider reports unavailable without SMTP configuration and classifies SMTP failures", async () => {
    assert.equal(createEmailProvider({ env: {} }).isConfigured(), false);
    const env = { SMTP_HOST: "smtp.invalid", EMAIL_FROM: "PSH <orders@example.invalid>" };
    const sent = [];
    const provider = createEmailProvider({
        env,
        transportFactory: () => ({ sendMail: async mail => { sent.push(mail); return { messageId: "m1" }; } })
    });
    assert.equal(provider.isConfigured(), true);
    assert.deepEqual(await provider.send({ to: "a@example.com", subject: "S", text: "T", html: "<p>T</p>" }), { messageId: "m1" });
    assert.equal(sent[0].to, "a@example.com");

    const failing = createEmailProvider({
        env,
        transportFactory: () => ({ sendMail: async () => { throw Object.assign(new Error("x"), { code: "ETIMEDOUT" }); } })
    });
    await assert.rejects(() => failing.send({ to: "a@example.com", subject: "S", text: "T", html: "H" }),
        error => error.temporary === true);
});

test("WhatsApp provider needs credentials and a per-event template, sends template-only messages", async () => {
    assert.equal(createWhatsappProvider({ env: {} }).isConfigured(), false);
    const env = { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123456789", WHATSAPP_TEMPLATE_ORDER_PLACED: "order_placed_v1" };
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.1" }] }) };
    };
    const provider = createWhatsappProvider({ env, fetchImpl });
    assert.equal(provider.hasTemplate("order_placed"), true);
    assert.equal(provider.hasTemplate("order_delivered"), false);
    const result = await provider.send({ to: "919876543210", type: "order_placed", params: ["Asha", "REF", "₹2,500.00", "COD"] });
    assert.equal(result.messageId, "wamid.1");
    assert.equal(calls[0].body.type, "template");
    assert.equal(calls[0].body.template.name, "order_placed_v1");
    assert.match(calls[0].url, /graph\.facebook\.com\/v20\.0\/123456789\/messages/);

    const rateLimited = createWhatsappProvider({ env, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
    await assert.rejects(() => rateLimited.send({ to: "919876543210", type: "order_placed", params: [] }), e => e.temporary === true);
    const rejected = createWhatsappProvider({ env, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 131026 } }) }) });
    await assert.rejects(() => rejected.send({ to: "919876543210", type: "order_placed", params: [] }), e => e.temporary === false);
});

test("Indian mobile numbers normalise and invalid numbers are rejected", () => {
    assert.equal(normalizeIndianMobile("98765 43210"), "919876543210");
    assert.equal(normalizeIndianMobile("+91 98765-43210"), "919876543210");
    assert.equal(normalizeIndianMobile("12345"), "");
    assert.equal(normalizeIndianMobile(undefined), "");
});

test("email templates escape dynamic values, only link https tracking, and hide unconfigured support contact", () => {
    const hostile = {
        ...order,
        status: "Shipped",
        address: { firstName: "<script>alert(1)</script>", email: "a@example.com" },
        items: [{ name: "<img src=x onerror=1>", quantity: 1, unitPricePaise: 100 }],
        shipping: { courierName: "C", trackingNumber: "T1", trackingUrl: "javascript:alert(1)" }
    };
    const { html, text, subject } = buildEmail("order_dispatched", hostile, { brandName: "PSH", support: {}, siteUrl: "https://example.com" });
    assert.equal(html.includes("<script>"), false);
    assert.equal(html.includes("<img src=x"), false);
    assert.equal(html.includes("javascript:"), false);
    assert.match(text, /T1/);
    assert.ok(subject.length > 0);
    assert.equal(/support/i.test(html), false);

    const safe = buildEmail("order_dispatched",
        { ...hostile, shipping: { courierName: "C", trackingNumber: "T1", trackingUrl: "https://track.example/T1" } },
        { brandName: "PSH", support: { email: "help@example.com" }, siteUrl: "https://example.com" });
    assert.match(safe.html, /https:\/\/track\.example\/T1/);
    assert.match(safe.html, /help@example\.com/);
});

test("payment success email reflects a held order and the real payment status", () => {
    const held = { ...order, paymentMethod: "Razorpay", paymentStatus: "paid", fulfillmentHold: true };
    const { text } = buildEmail("payment_success", held, { brandName: "PSH", support: {}, siteUrl: "https://example.com" });
    assert.match(text, /reviewing/);
});
