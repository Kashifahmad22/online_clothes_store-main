// Customer-facing merchandising derived from inventory. Exact quantities are never part of the result.
export const DEFAULT_LOW_STOCK_THRESHOLD = 2;

const wholeNumber = value => Number.isSafeInteger(value) && value >= 0;

// A product carries at most one admin-chosen badge. Fields omitted by older admin payloads keep their
// stored value, and choosing one badge clears the other.
export const resolveBadgeFlags = (payload, existing = {}) => {
    let bestseller = payload.bestseller === undefined ? existing.bestseller === true : payload.bestseller === true;
    let fastSelling = payload.fastSelling === undefined ? existing.fastSelling === true : payload.fastSelling === true;
    if (bestseller && fastSelling) {
        if (payload.bestseller === true) fastSelling = false;
        else bestseller = false;
    }
    return { bestseller, fastSelling };
};

// Low stock means there is something to buy, but fewer units than the threshold remain.
// Missing or malformed stock figures are treated as unreliable and never produce a badge.
export const isLowStock = variants => {
    const active = (Array.isArray(variants) ? variants : []).filter(variant => variant && variant.active !== false);
    if (active.length === 0) return false;

    let available = 0;
    let threshold = 0;
    for (const variant of active) {
        const reserved = variant.reserved ?? 0;
        if (!wholeNumber(variant.stockOnHand) || !wholeNumber(reserved)) return false;
        available += Math.max(0, variant.stockOnHand - reserved);
        const own = wholeNumber(variant.lowStockThreshold) ? variant.lowStockThreshold : DEFAULT_LOW_STOCK_THRESHOLD;
        threshold = Math.max(threshold, own);
    }
    return available > 0 && available < threshold;
};

// Customer-available units: active variants only, on hand minus reserved, never negative.
// A variant with unreliable figures contributes nothing, matching isLowStock's refusal to trust them.
export const availableUnits = variants => (Array.isArray(variants) ? variants : [])
    .filter(variant => variant && variant.active !== false)
    .reduce((total, variant) => {
        const reserved = variant.reserved ?? 0;
        if (!wholeNumber(variant.stockOnHand) || !wholeNumber(reserved)) return total;
        return total + Math.max(0, variant.stockOnHand - reserved);
    }, 0);

// out-of-stock: nothing available (including no active variants); low-stock: isLowStock; otherwise in-stock.
export const stockState = variants => {
    if (availableUnits(variants) === 0) return "out-of-stock";
    return isLowStock(variants) ? "low-stock" : "in-stock";
};

// The storefront's "from" price: the lowest price among purchasable variants (active, with available
// stock), where a variant without an override uses the base price. With none purchasable it is the base.
export const startingPricePaise = (basePaise, variants) => {
    const prices = (Array.isArray(variants) ? variants : [])
        .filter(variant => variant && variant.active !== false &&
            (Number(variant.stockOnHand) || 0) - (Number(variant.reserved) || 0) > 0)
        .map(variant => variant.priceOverridePaise ?? basePaise)
        .filter(price => Number.isFinite(price));
    return prices.length ? Math.min(...prices) : basePaise;
};
