import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkDelivery, resetDeliveryTokenCache, summariseCouriers } from "../utils/deliveryService.js";

const env = {
    DELIVERY_PROVIDER: "shiprocket",
    SHIPROCKET_EMAIL: "a@example.test",
    SHIPROCKET_PASSWORD: "not-a-real-password",
    DELIVERY_PICKUP_PINCODE: "800001",
    DELIVERY_HANDLING_DAYS: "1"
};
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const provider = serviceability => async url => (
    String(url).includes("/auth/login") ? reply(200, { token: "t" }) : serviceability(url)
);

beforeEach(() => resetDeliveryTokenCache());

test("invalid PIN codes are rejected without any provider call", async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return reply(200, {}); };
    for (const pin of ["", "12345", "1234567", "012345", "80000a", undefined]) {
        assert.equal((await checkDelivery(pin, { env, fetchImpl })).status, "invalid");
    }
    assert.equal(called, false);
});

test("without provider configuration the answer is manual confirmation with no estimate", async () => {
    let called = false;
    const result = await checkDelivery("800001", { env: {}, fetchImpl: async () => { called = true; } });
    assert.equal(result.status, "manual_confirmation");
    assert.equal(result.estimate, undefined);
    assert.equal(called, false);
});

test("incomplete provider configuration falls back to manual confirmation", async () => {
    const result = await checkDelivery("800001", { env: { ...env, SHIPROCKET_PASSWORD: "" }, fetchImpl: async () => reply(200, {}) });
    assert.equal(result.status, "manual_confirmation");
});

test("provider couriers produce a serviceable result with an estimate including handling days", async () => {
    const fetchImpl = provider(() => reply(200, { data: { available_courier_companies: [
        { etd: "Nov 6, 2026", cod: 1 }, { etd: "Nov 9, 2026", cod: 0 }
    ] } }));
    const result = await checkDelivery("110001", { env, fetchImpl, now: Date.UTC(2026, 10, 1) });
    assert.equal(result.status, "serviceable");
    assert.deepEqual(result.estimate, { from: "2026-11-07", to: "2026-11-10" });
});

test("serviceable without parseable estimates promises no date", async () => {
    const fetchImpl = provider(() => reply(200, { data: { available_courier_companies: [{ etd: "soon" }] } }));
    const result = await checkDelivery("110001", { env, fetchImpl });
    assert.equal(result.status, "serviceable");
    assert.equal(result.estimate, undefined);
});

test("no couriers or a 404 means not serviceable", async () => {
    const none = provider(() => reply(200, { data: { available_courier_companies: [] } }));
    assert.equal((await checkDelivery("110001", { env, fetchImpl: none })).status, "not_serviceable");
    resetDeliveryTokenCache();
    const missing = provider(() => reply(404, {}));
    assert.equal((await checkDelivery("110001", { env, fetchImpl: missing })).status, "not_serviceable");
});

test("provider failures, bad payloads and timeouts are unavailable, never serviceable", async () => {
    const cases = [
        provider(() => reply(500, {})),
        provider(() => reply(200, { data: {} })),
        provider(() => { throw new Error("network down"); }),
        async () => reply(401, {})
    ];
    for (const fetchImpl of cases) {
        resetDeliveryTokenCache();
        const result = await checkDelivery("110001", { env, fetchImpl });
        assert.equal(result.status, "unavailable");
        assert.equal(result.estimate, undefined);
    }
});

test("summariseCouriers ignores unparseable dates", () => {
    assert.equal(summariseCouriers([{ etd: "x" }, {}], 0), null);
});
