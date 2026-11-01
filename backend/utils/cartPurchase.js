import userModel from "../models/userModel.js";

const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/;

// Removes only what an order actually bought from a customer's saved cart. Anything added, or any larger
// quantity chosen, after checkout started stays. Every step is a single conditional update, so nothing is read
// and then overwritten, and a concurrent cart edit cannot be clobbered. Callers invoke it once per order
// settlement (a repeat settlement returns before reaching it), which is what makes it safe under duplicate
// webhook and verification calls.
export const removePurchasedFromCart = async (userId, items, session) => {
    const products = new Set();
    for (const item of items || []) {
        const productId = String(item.productId);
        const variantId = String(item.variantId);
        const quantity = item.quantity;
        if (!SAFE_KEY.test(productId) || !SAFE_KEY.test(variantId) || !Number.isSafeInteger(quantity) || quantity < 1) continue;
        const path = `cartData.${productId}.${variantId}`;
        const reduced = await userModel.updateOne(
            { _id: userId, [path]: { $gt: quantity } },
            { $inc: { [path]: -quantity } },
            { session }
        );
        if (!reduced.matchedCount) {
            await userModel.updateOne(
                { _id: userId, [path]: { $lte: quantity } },
                { $unset: { [path]: "" } },
                { session }
            );
        }
        products.add(productId);
    }
    for (const productId of products) {
        const key = `cartData.${productId}`;
        await userModel.updateOne({ _id: userId, [key]: {} }, { $unset: { [key]: "" } }, { session });
    }
};
