import { resolveBadgeFlags } from "./merchandising.js";

// Optional numeric fields: undefined = the payload did not mention it (keep the stored value),
// null = the admin deliberately cleared it ($unset), number = set it.
export const applyOptionalNumber = (set, unset, field, value) => {
    if (value === null) unset[field] = "";
    else if (value !== undefined) set[field] = value;
};

export const buildProductUpdate = ({ payload, product, images, status }) => {
    const set = {
        name: payload.name.trim(),
        slug: payload.slug?.trim().toLowerCase() || product.slug,
        description: payload.description.trim(),
        productType: payload.productType,
        category: payload.category.trim(),
        subCategory: payload.subCategory || "",
        collections: payload.collections || [],
        pricePaise: payload.pricePaise,
        images,
        details: payload.details || {},
        status,
        ...resolveBadgeFlags(payload, product),
        seo: payload.seo || {}
    };
    const unset = {};
    applyOptionalNumber(set, unset, "mrpPaise", payload.mrpPaise);
    const update = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    return update;
};
