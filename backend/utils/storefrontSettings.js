const invalidInput = message => Object.assign(new Error(message), { status: 400 });
const groups = new Set(["shop", "support", "policies"]);

export const defaultStorefrontSettings = {
    brand: {
        publicName: "PSH Sarees & Ethnic Wear",
        tagline: "The Art of Indian Ethnic Wear.",
        description: "Discover sarees and ethnic wear with product information shown as supplied.",
        logoUrl: "",
        footerArtwork: "madhubani"
    },
    support: { phone: "", whatsapp: "", email: "", businessHours: "", description: "" },
    legal: {
        businessName: "Patna Saree Handloom",
        gstin: "",
        registeredAddress: "",
        sellerInformation: "",
        grievanceContact: ""
    },
    footerLinks: [
        { label: "Shop all", url: "/collection", group: "shop" },
        { label: "Sarees", url: "/category/sarees", group: "shop" },
        { label: "About PSH", url: "/about", group: "support" },
        { label: "Contact", url: "/contact", group: "support" },
        { label: "My orders", url: "/orders", group: "support" }
    ],
    socialLinks: [],
    shipping: { feePaise: 5000, freeShippingThresholdPaise: null, message: "" },
    announcement: { enabled: false, text: "", url: "" },
    upcomingCategories: ["Lungis", "Kurtis", "Other women's ethnic wear"]
};

const cleanText = (value, label, maximum, optional = true) => {
    if (typeof value !== "string") throw invalidInput(`${label} must be text.`);
    const text = value.trim();
    if (!optional && !text) throw invalidInput(`${label} is required.`);
    if (text.length > maximum) throw invalidInput(`${label} cannot exceed ${maximum} characters.`);
    return text;
};

const cleanUrl = (value, label, { internal = false, optional = true } = {}) => {
    const text = cleanText(value, label, 500, optional);
    if (!text) return "";
    if (internal && text.startsWith("/") && !text.startsWith("//")) return text;
    try {
        const url = new URL(text);
        if (url.protocol === "https:") return text;
    } catch {
        throw invalidInput(`${label} must be an HTTPS URL${internal ? " or an internal path" : ""}.`);
    }
    throw invalidInput(`${label} must be an HTTPS URL${internal ? " or an internal path" : ""}.`);
};

const cleanList = (value, label, maximumItems, parseItem) => {
    if (!Array.isArray(value) || value.length > maximumItems) {
        throw invalidInput(`${label} must contain no more than ${maximumItems} entries.`);
    }
    return value.map(parseItem);
};

export const parseStorefrontSettings = raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw invalidInput("Storefront settings are required.");
    }
    const { brand, support, legal, footerLinks, socialLinks, shipping, announcement, upcomingCategories } = raw;
    for (const [value, label] of [
        [brand, "Brand"], [support, "Support"], [legal, "Legal information"],
        [shipping, "Shipping"], [announcement, "Announcement"]
    ]) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw invalidInput(`${label} settings are required.`);
        }
    }
    if (!["madhubani", "none"].includes(brand.footerArtwork)) {
        throw invalidInput("Footer artwork must be Madhubani or none.");
    }
    if (typeof announcement.enabled !== "boolean") {
        throw invalidInput("Announcement enabled must be true or false.");
    }

    const phone = cleanText(support.phone, "Support phone", 30);
    const whatsapp = cleanText(support.whatsapp, "WhatsApp number", 20);
    const email = cleanText(support.email, "Support email", 254).toLowerCase();
    const gstin = cleanText(legal.gstin, "GSTIN", 15).toUpperCase();
    if (phone && !/^(?:\+91[\s-]?)?[6-9]\d{9}$/.test(phone.replace(/[\s-]/g, ""))) {
        throw invalidInput("Support phone must be a valid Indian phone number.");
    }
    if (whatsapp && !/^(?:\+91)?[6-9]\d{9}$/.test(whatsapp.replace(/[\s-]/g, ""))) {
        throw invalidInput("WhatsApp must be a valid Indian mobile number with an optional +91 prefix.");
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw invalidInput("Support email must be a valid email address.");
    }
    if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
        throw invalidInput("GSTIN must be a valid 15-character GST identification number.");
    }
    if (!Number.isSafeInteger(shipping.feePaise) || shipping.feePaise < 0) {
        throw invalidInput("Shipping fee must be a non-negative whole number of paise.");
    }
    const freeShippingThresholdPaise = shipping.freeShippingThresholdPaise ?? null;
    if (freeShippingThresholdPaise !== null &&
        (!Number.isSafeInteger(freeShippingThresholdPaise) || freeShippingThresholdPaise < 1)) {
        throw invalidInput("Free-shipping threshold must be a positive whole number of paise.");
    }
    if (announcement.enabled && !cleanText(announcement.text, "Announcement text", 180, false)) {
        throw invalidInput("Announcement text is required when the announcement is enabled.");
    }

    return {
        brand: {
            publicName: cleanText(brand.publicName, "Public brand name", 100, false),
            tagline: cleanText(brand.tagline, "Brand tagline", 160),
            description: cleanText(brand.description, "Brand description", 500),
            logoUrl: cleanUrl(brand.logoUrl, "Logo URL"),
            footerArtwork: brand.footerArtwork
        },
        support: {
            phone,
            whatsapp,
            email,
            businessHours: cleanText(support.businessHours, "Business hours", 160),
            description: cleanText(support.description, "Support description", 240)
        },
        legal: {
            businessName: cleanText(legal.businessName, "Legal business name", 160),
            gstin,
            registeredAddress: cleanText(legal.registeredAddress, "Registered address", 500),
            sellerInformation: cleanText(legal.sellerInformation, "Seller information", 500),
            grievanceContact: cleanText(legal.grievanceContact, "Grievance contact", 300)
        },
        footerLinks: cleanList(footerLinks, "Footer links", 20, link => {
            if (!link || typeof link !== "object" || !groups.has(link.group)) {
                throw invalidInput("Each footer link needs a valid group.");
            }
            return {
                label: cleanText(link.label, "Footer link label", 60, false),
                url: cleanUrl(link.url, "Footer link URL", { internal: true, optional: false }),
                group: link.group
            };
        }),
        socialLinks: cleanList(socialLinks, "Social links", 8, link => {
            if (!link || typeof link !== "object") throw invalidInput("Each social link must be an object.");
            return {
                label: cleanText(link.label, "Social link label", 40, false),
                url: cleanUrl(link.url, "Social link URL", { optional: false })
            };
        }),
        shipping: {
            feePaise: shipping.feePaise,
            freeShippingThresholdPaise,
            message: cleanText(shipping.message, "Shipping message", 240)
        },
        announcement: {
            enabled: announcement.enabled,
            text: cleanText(announcement.text, "Announcement text", 180),
            url: cleanUrl(announcement.url, "Announcement URL", { internal: true })
        },
        upcomingCategories: cleanList(upcomingCategories, "Upcoming categories", 12,
            category => cleanText(category, "Upcoming category", 60, false))
    };
};


export const toPublicStorefrontSettings = (settings, { prepaidAvailable = false } = {}) => {
    const value = settings?.toObject ? settings.toObject() : settings;
    const source = value || defaultStorefrontSettings;
    return {
        brand: source.brand,
        support: source.support,
        legal: source.legal,
        footerLinks: source.footerLinks,
        socialLinks: source.socialLinks,
        shipping: source.shipping,
        announcement: source.announcement,
        upcomingCategories: source.upcomingCategories,
        checkout: { codAvailable: true, prepaidAvailable, serviceabilityCheckAvailable: false }
    };
};
