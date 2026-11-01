import productVariantModel from "../models/productVariantModel.js";

// Permanently takes stock for an already-paid order whose reservation is gone. Each item is one conditional
// update that only succeeds while unreserved stock covers it, so stock can never go negative or eat into
// another customer's reservation. If any item fails, items already taken are put back inside the same
// transaction and the function reports false; the caller then records a review hold instead of fulfilling.
export const deductAvailableStock = async (items, session) => {
    const taken = [];
    for (const item of items) {
        const result = await productVariantModel.updateOne({
            _id: item.variantId,
            $expr: {
                $gte: [
                    { $subtract: ["$stockOnHand", { $ifNull: ["$reserved", 0] }] },
                    item.quantity
                ]
            }
        }, { $inc: { stockOnHand: -item.quantity } }, { session });
        if (result.modifiedCount !== 1) {
            for (const done of taken) {
                const undo = await productVariantModel.updateOne(
                    { _id: done.variantId },
                    { $inc: { stockOnHand: done.quantity } },
                    { session }
                );
                if (undo.modifiedCount !== 1) {
                    throw new Error("Unable to safely undo a partial stock acquisition.");
                }
            }
            return false;
        }
        taken.push(item);
    }
    return true;
};
