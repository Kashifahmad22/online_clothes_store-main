import mongoose from "mongoose";
import userModel from "../models/userModel.js";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";

const getAvailableVariant = async (productId, variantId) => {
    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(variantId)) {
        return null;
    }
    const [product, variant] = await Promise.all([
        productModel.findOne({ _id: productId, status: "published" }).select("_id"),
        productVariantModel.findOne({ _id: variantId, productId, active: true })
    ]);
    if (!product || !variant || variant.stockOnHand - variant.reserved <= 0) return null;
    return variant;
};

const addToCart = async (req, res) => {
    try {
        const { productId, variantId } = req.body;
        const variant = await getAvailableVariant(productId, variantId);
        if (!variant) return res.status(409).json({ success: false, message: "This item is unavailable." });

        const path = `cartData.${productId}.${variantId}`;
        const user = await userModel.findByIdAndUpdate(
            req.auth.userId,
            { $inc: { [path]: 1 } },
            { new: true }
        );
        if (!user) return res.status(404).json({ success: false, message: "Customer account not found." });
        return res.json({ success: true, message: "Added to cart." });
    } catch (error) {
        console.error("Add to cart failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to update the cart." });
    }
};

const updateCart = async (req, res) => {
    try {
        const { productId, variantId, quantity } = req.body;
        if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 99) {
            return res.status(400).json({ success: false, message: "Quantity must be between 0 and 99." });
        }
        if (quantity > 0) {
            const variant = await getAvailableVariant(productId, variantId);
            if (!variant || quantity > variant.stockOnHand - variant.reserved) {
                return res.status(409).json({ success: false, message: "Requested quantity is unavailable." });
            }
        }
        if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(variantId)) {
            return res.status(400).json({ success: false, message: "Invalid product or variant." });
        }
        const path = `cartData.${productId}.${variantId}`;
        const update = quantity === 0
            ? { $unset: { [path]: 1 } }
            : { $set: { [path]: quantity } };
        const user = await userModel.findByIdAndUpdate(req.auth.userId, update, { new: true });
        if (!user) return res.status(404).json({ success: false, message: "Customer account not found." });
        return res.json({ success: true, message: "Cart updated." });
    } catch (error) {
        console.error("Cart update failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to update the cart." });
    }
};

const getUserCart = async (req, res) => {
    try {
        const user = await userModel.findById(req.auth.userId).select("cartData");
        if (!user) return res.status(404).json({ success: false, message: "Customer account not found." });
        return res.json({ success: true, cartData: user.cartData });
    } catch (error) {
        console.error("Load cart failed:", { name: error.name || "Error" });
        return res.status(500).json({ success: false, message: "Unable to load the cart." });
    }
};

export { addToCart, getUserCart, updateCart };
