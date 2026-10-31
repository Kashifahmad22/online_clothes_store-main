import mongoose from "mongoose";

const linkSchema = new mongoose.Schema({
    label: { type: String, required: true, trim: true, maxlength: 60 },
    url: { type: String, required: true, trim: true, maxlength: 500 },
    group: { type: String, enum: ["shop", "support", "policies"], required: true }
}, { _id: false });

const socialLinkSchema = new mongoose.Schema({
    label: { type: String, required: true, trim: true, maxlength: 40 },
    url: { type: String, required: true, trim: true, maxlength: 500 }
}, { _id: false });

const settingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: "primary" },
    brand: {
        publicName: { type: String, required: true, trim: true, maxlength: 100 },
        tagline: { type: String, trim: true, maxlength: 160, default: "" },
        description: { type: String, trim: true, maxlength: 500, default: "" },
        logoUrl: { type: String, trim: true, maxlength: 500, default: "" },
        footerArtwork: { type: String, enum: ["madhubani", "none"], default: "madhubani" }
    },
    support: {
        phone: { type: String, trim: true, maxlength: 30, default: "" },
        whatsapp: { type: String, trim: true, maxlength: 20, default: "" },
        email: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
        businessHours: { type: String, trim: true, maxlength: 160, default: "" },
        description: { type: String, trim: true, maxlength: 240, default: "" }
    },
    legal: {
        businessName: { type: String, trim: true, maxlength: 160, default: "Patna Saree Handloom" },
        gstin: { type: String, trim: true, uppercase: true, maxlength: 15, default: "" },
        registeredAddress: { type: String, trim: true, maxlength: 500, default: "" },
        sellerInformation: { type: String, trim: true, maxlength: 500, default: "" },
        grievanceContact: { type: String, trim: true, maxlength: 300, default: "" }
    },
    footerLinks: { type: [linkSchema], default: [] },
    socialLinks: { type: [socialLinkSchema], default: [] },
    shipping: {
        feePaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: 5000 },
        freeShippingThresholdPaise: {
            type: Number,
            min: 1,
            validate: value => value == null || Number.isSafeInteger(value),
            default: null
        },
        message: { type: String, trim: true, maxlength: 240, default: "" }
    },
    announcement: {
        enabled: { type: Boolean, default: false },
        text: { type: String, trim: true, maxlength: 180, default: "" },
        url: { type: String, trim: true, maxlength: 500, default: "" }
    },
    upcomingCategories: {
        type: [{ type: String, trim: true, maxlength: 60 }],
        default: ["Lungis", "Kurtis", "Other women's ethnic wear"]
    }
}, { timestamps: true, minimize: false });

const storefrontSettingsModel = mongoose.models.storefrontSettings ||
    mongoose.model("storefrontSettings", settingsSchema);

export default storefrontSettingsModel;
