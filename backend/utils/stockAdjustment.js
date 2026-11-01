const invalidInput = message => Object.assign(new Error(message), { status: 400 });

export const MAX_STOCK_ADJUSTMENT = 100000;
export const MAX_STOCK_ON_HAND = 1000000;
export const STOCK_OPERATIONS = ["receive", "correction"];

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

// Validates a manual stock adjustment. The quantity is always a signed whole-number change (never an
// absolute value), so a stale form can never overwrite stock that an order has since removed.
export const parseStockAdjustment = raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw invalidInput("Stock adjustment details are required.");
    }
    if (!STOCK_OPERATIONS.includes(raw.operation)) {
        throw invalidInput("Choose either Receive stock or Stock correction.");
    }
    const { quantity } = raw;
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity)) {
        throw invalidInput("Quantity must be a whole number.");
    }
    if (quantity === 0) {
        throw invalidInput("Quantity cannot be zero.");
    }
    if (Math.abs(quantity) > MAX_STOCK_ADJUSTMENT) {
        throw invalidInput(`A single adjustment cannot exceed ${MAX_STOCK_ADJUSTMENT} pieces.`);
    }
    if (raw.operation === "receive" && quantity < 0) {
        throw invalidInput("Received stock must be a positive quantity. Use Stock correction to reduce stock.");
    }

    let reason = "";
    if (raw.reason !== undefined && raw.reason !== null) {
        if (typeof raw.reason !== "string") throw invalidInput("Reason must be text.");
        reason = raw.reason.trim();
        if (reason.length > 200) throw invalidInput("Reason must be 200 characters or fewer.");
        if (CONTROL_CHARACTERS.test(reason)) throw invalidInput("Reason contains unsupported characters.");
    }
    if (raw.operation === "correction" && reason.length < 3) {
        throw invalidInput("Enter a reason of at least 3 characters for a stock correction.");
    }

    return { operation: raw.operation, delta: quantity, reason };
};

// One conditional $inc on a single document. MongoDB evaluates the guard and the increment atomically, so
// concurrent order decrements and stock receipts cannot overwrite each other, and stockOnHand can never be
// taken below the units already reserved for pending payments. `reserved` itself is never modified.
export const buildStockAdjustment = (productId, variantId, delta) => {
    const projected = { $add: [{ $ifNull: ["$stockOnHand", 0] }, delta] };
    return {
        filter: {
            _id: variantId,
            productId,
            $expr: {
                $and: [
                    { $gte: [projected, { $ifNull: ["$reserved", 0] }] },
                    { $lte: [projected, MAX_STOCK_ON_HAND] }
                ]
            }
        },
        update: { $inc: { stockOnHand: delta } }
    };
};

export const toStockSummary = variant => {
    const stockOnHand = Number.isSafeInteger(variant?.stockOnHand) ? variant.stockOnHand : 0;
    const reserved = Number.isSafeInteger(variant?.reserved) ? variant.reserved : 0;
    return {
        _id: String(variant._id),
        sku: variant.sku,
        active: variant.active !== false,
        stockOnHand,
        reserved,
        available: Math.max(0, stockOnHand - reserved)
    };
};
