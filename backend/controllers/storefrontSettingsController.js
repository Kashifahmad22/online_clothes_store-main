import storefrontSettingsModel from "../models/storefrontSettingsModel.js";
import {
    defaultStorefrontSettings,
    parseStorefrontSettings,
    toPublicStorefrontSettings
} from "../utils/storefrontSettings.js";
import { isRazorpayTestConfigured } from "../utils/razorpayConfig.js";

export const getPublicStorefrontSettings = async (req, res) => {
    try {
        const settings = await storefrontSettingsModel.findOne({ key: "primary" }).lean();
        return res.json({
            success: true,
            settings: toPublicStorefrontSettings(settings || defaultStorefrontSettings, {
                prepaidAvailable: isRazorpayTestConfigured()
            })
        });
    } catch (error) {
        console.error("Public storefront settings request failed:", {
            name: typeof error.name === "string" ? error.name : "Error"
        });
        return res.status(500).json({ success: false, message: "Unable to load storefront information." });
    }
};

export const getAdminStorefrontSettings = async (req, res) => {
    try {
        const settings = await storefrontSettingsModel.findOne({ key: "primary" }).lean();
        return res.json({
            success: true,
            settings: toPublicStorefrontSettings(settings || defaultStorefrontSettings, {
                prepaidAvailable: isRazorpayTestConfigured()
            })
        });
    } catch (error) {
        console.error("Admin storefront settings request failed:", {
            name: typeof error.name === "string" ? error.name : "Error"
        });
        return res.status(500).json({ success: false, message: "Unable to load storefront settings." });
    }
};

export const updateStorefrontSettings = async (req, res) => {
    try {
        const settings = parseStorefrontSettings(req.body);
        const saved = await storefrontSettingsModel.findOneAndUpdate(
            { key: "primary" },
            { $set: settings, $setOnInsert: { key: "primary" } },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
        return res.json({
            success: true,
            settings: toPublicStorefrontSettings(saved, {
                prepaidAvailable: isRazorpayTestConfigured()
            })
        });
    } catch (error) {
        if (error.status === 400 || error.name === "ValidationError") {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error("Storefront settings update failed:", {
            name: typeof error.name === "string" ? error.name : "Error"
        });
        return res.status(500).json({ success: false, message: "Unable to save storefront settings." });
    }
};
