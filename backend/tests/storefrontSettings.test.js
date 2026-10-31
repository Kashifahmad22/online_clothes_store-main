import test from "node:test";
import assert from "node:assert/strict";
import storefrontSettingsModel from "../models/storefrontSettingsModel.js";
import {
    MAX_POLICY_LENGTH,
    defaultStorefrontSettings,
    parseStorefrontSettings,
    toPublicStorefrontSettings
} from "../utils/storefrontSettings.js";

const validSettings = () => structuredClone(defaultStorefrontSettings);

test("validates the public brand settings and MongoDB schema", async () => {
    const settings = parseStorefrontSettings(validSettings());
    assert.equal(settings.brand.publicName, "PSH Sarees & Ethnic Wear");
    const document = new storefrontSettingsModel(settings);
    await document.validate();
});

test("rejects unverified or unsafe link protocols", () => {
    const settings = validSettings();
    settings.socialLinks = [{ label: "Social", url: "javascript:alert(1)" }];
    assert.throws(() => parseStorefrontSettings(settings), /HTTPS URL/);

    settings.socialLinks = [];
    settings.footerLinks[0].url = "//example.test/path";
    assert.throws(() => parseStorefrontSettings(settings), /HTTPS URL or an internal path/);
});

test("rejects invalid Indian contact, GST and enabled announcement data", () => {
    const settings = validSettings();
    settings.support.phone = "123";
    assert.throws(() => parseStorefrontSettings(settings), /valid Indian phone number/);

    settings.support.phone = "";
    settings.legal.gstin = "not-a-gstin";
    assert.throws(() => parseStorefrontSettings(settings), /valid 15-character/);

    settings.legal.gstin = "";
    settings.announcement = { enabled: true, text: "", url: "" };
    assert.throws(() => parseStorefrontSettings(settings), /Announcement text is required/);
});

test("announcement: enabled, disabled, empty and separator-only messages", () => {
    const enabled = parseStorefrontSettings(validSettings());
    assert.equal(enabled.announcement.enabled, true);
    assert.equal(enabled.announcement.text.split(" | ").length, 4);

    const disabled = validSettings();
    disabled.announcement = { enabled: false, text: "", url: "" };
    assert.deepEqual(parseStorefrontSettings(disabled).announcement, { enabled: false, text: "", url: "" });

    const separatorsOnly = validSettings();
    separatorsOnly.announcement = { enabled: true, text: " | | ", url: "" };
    assert.throws(() => parseStorefrontSettings(separatorsOnly), /Announcement text is required/);
});

test("announcement text is sanitised, capped and its URL restricted", () => {
    const settings = validSettings();
    settings.announcement = { enabled: true, text: "  One\u0000 \n|Two   words|  ", url: "/collection" };
    assert.deepEqual(parseStorefrontSettings(settings).announcement,
        { enabled: true, text: "One | Two words", url: "/collection" });

    settings.announcement.text = "x".repeat(181);
    assert.throws(() => parseStorefrontSettings(settings), /cannot exceed 180/);

    settings.announcement.text = Array.from({ length: 9 }, (_, index) => `M${index}`).join("|");
    assert.throws(() => parseStorefrontSettings(settings), /no more than 8 messages/);

    settings.announcement.text = "Sale";
    for (const url of ["javascript:alert(1)", "//evil.test", "http://insecure.test"]) {
        settings.announcement.url = url;
        assert.throws(() => parseStorefrontSettings(settings), /URL/);
    }
    settings.announcement = { enabled: "yes", text: "Sale", url: "" };
    assert.throws(() => parseStorefrontSettings(settings), /true or false/);
    settings.announcement = [];
    assert.throws(() => parseStorefrontSettings(settings), /must be an object/);
});

test("older payloads without announcement keep the saved announcement and the result validates", async () => {
    const legacy = validSettings();
    delete legacy.announcement;
    const parsed = parseStorefrontSettings(legacy);
    assert.equal("announcement" in parsed, false);
    await new storefrontSettingsModel(parsed).validate();

    const full = parseStorefrontSettings(validSettings());
    await new storefrontSettingsModel(full).validate();
});

test("public settings allow-list the announcement and tolerate legacy documents", () => {
    const published = toPublicStorefrontSettings({
        ...validSettings(),
        announcement: { enabled: true, text: "Sale", url: "/collection", adminNote: "private" }
    });
    assert.deepEqual(published.announcement, { enabled: true, text: "Sale", url: "/collection" });

    const legacyDocument = validSettings();
    delete legacyDocument.announcement;
    assert.deepEqual(toPublicStorefrontSettings(legacyDocument).announcement,
        { enabled: false, text: "", url: "" });
    assert.equal(toPublicStorefrontSettings({ ...validSettings(), announcement: { text: "Hi" } })
        .announcement.enabled, false);
});

test("validates the shipping fee and only accepts a positive optional free-shipping threshold", () => {
    const settings = validSettings();
    settings.shipping.feePaise = -1;
    assert.throws(() => parseStorefrontSettings(settings), /Shipping fee/);

    settings.shipping.feePaise = 5000;
    settings.shipping.freeShippingThresholdPaise = 0;
    assert.throws(() => parseStorefrontSettings(settings), /positive whole number of paise/);
});

test("keeps checkout payment capability server-derived and public output allow-listed", () => {
    const publicSettings = toPublicStorefrontSettings({
        ...validSettings(),
        privateSecret: "must not be serialized"
    });
    assert.deepEqual(publicSettings.checkout, {
        codAvailable: true,
        prepaidAvailable: false,
        serviceabilityCheckAvailable: false
    });
    assert.equal("privateSecret" in publicSettings, false);
});

test("policy text is optional, validated, length-capped and omitted when not sent", async () => {
    const withoutPolicies = validSettings();
    delete withoutPolicies.policies;
    assert.equal("policies" in parseStorefrontSettings(withoutPolicies), false);

    const settings = validSettings();
    settings.policies = { privacy: "  Privacy text  ", terms: "", shipping: "Shipping text" };
    const parsed = parseStorefrontSettings(settings);
    assert.deepEqual(parsed.policies, { privacy: "Privacy text", terms: "", shipping: "Shipping text", returns: "" });
    await new storefrontSettingsModel(parsed).validate();

    settings.policies = { privacy: "x".repeat(MAX_POLICY_LENGTH + 1) };
    assert.throws(() => parseStorefrontSettings(settings), /privacy policy cannot exceed/);
    settings.policies = { privacy: 5 };
    assert.throws(() => parseStorefrontSettings(settings), /must be text/);
    settings.policies = [];
    assert.throws(() => parseStorefrontSettings(settings), /Policy settings must be an object/);
});

test("public settings always expose all four policy keys, empty by default, with no extras", () => {
    const empty = toPublicStorefrontSettings(defaultStorefrontSettings);
    assert.deepEqual(empty.policies, { privacy: "", terms: "", shipping: "", returns: "" });

    const legacyDocument = validSettings();
    delete legacyDocument.policies;
    assert.deepEqual(toPublicStorefrontSettings(legacyDocument).policies, empty.policies);

    const published = toPublicStorefrontSettings({
        ...validSettings(),
        policies: { privacy: "Published", adminNote: "must not be serialized" }
    });
    assert.equal(published.policies.privacy, "Published");
    assert.equal(published.policies.terms, "");
});
