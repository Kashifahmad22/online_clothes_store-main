const invalidInput = message => Object.assign(new Error(message), { status: 400 });

const DEFAULT_LOW_STOCK_THRESHOLD = 2;

// Decides how an edit payload changes the stored variants, without touching the database.
//  - A saved SKU keeps its identity: it is matched by id or SKU, and its SKU text can never be changed.
//  - Stock quantities are never written here; they change only through the stock adjustment endpoint.
//  - Variants omitted from the payload are left exactly as they are (never silently deactivated).
//  - `active` changes only when the payload sets it explicitly, so an unrelated save cannot reactivate
//    an inactive SKU or deactivate an active one.
//  - priceOverridePaise: undefined = leave unchanged, null = clear, number = set.
export const planVariantChanges = (existing, incoming) => {
    const bySku = new Map(existing.map(item => [String(item.sku).toUpperCase(), item]));
    const byId = new Map(existing.map(item => [String(item._id), item]));
    const updates = [];
    const creates = [];
    const activeOverrides = new Map();

    for (const variant of incoming) {
        const sku = variant.sku.trim().toUpperCase();
        const matchedById = variant._id === undefined ? undefined : byId.get(String(variant._id));
        if (matchedById && String(matchedById.sku).toUpperCase() !== sku) {
            throw invalidInput(`The SKU of a saved variant (${matchedById.sku}) cannot be changed. Add a new SKU instead.`);
        }
        const current = matchedById || bySku.get(sku);

        if (current) {
            const set = {};
            const unset = {};
            if (variant.options !== undefined) set.options = variant.options;
            if (Number.isSafeInteger(variant.lowStockThreshold)) set.lowStockThreshold = variant.lowStockThreshold;
            if (typeof variant.active === "boolean") {
                set.active = variant.active;
                activeOverrides.set(String(current._id), variant.active);
            }
            if (variant.priceOverridePaise === null) unset.priceOverridePaise = "";
            else if (variant.priceOverridePaise !== undefined) set.priceOverridePaise = variant.priceOverridePaise;
            updates.push({ id: current._id, sku: current.sku, set, unset });
        } else {
            creates.push({
                sku,
                options: variant.options || {},
                priceOverridePaise: variant.priceOverridePaise ?? undefined,
                stockOnHand: variant.stockOnHand,
                lowStockThreshold: Number.isSafeInteger(variant.lowStockThreshold)
                    ? variant.lowStockThreshold
                    : DEFAULT_LOW_STOCK_THRESHOLD,
                active: variant.active !== false
            });
        }
    }

    const activeExisting = existing.filter(item => {
        const override = activeOverrides.get(String(item._id));
        return override === undefined ? item.active !== false : override;
    }).length;
    const activeCount = activeExisting + creates.filter(item => item.active).length;

    return { updates, creates, activeCount };
};
