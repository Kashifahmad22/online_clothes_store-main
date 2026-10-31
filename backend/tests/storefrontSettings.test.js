import test from "node:test";
import assert from "node:assert/strict";
import storefrontSettingsModel from "../models/storefrontSettingsModel.js";
import {
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
    settings.announcement.enabled = true;
    assert.throws(() => parseStorefrontSettings(settings), /Announcement text is required/);
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
