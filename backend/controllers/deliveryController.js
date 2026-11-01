import { DELIVERY_STATUS, checkDelivery } from "../utils/deliveryService.js";

export const checkDeliveryAvailability = async (req, res) => {
    const pincode = typeof req.query?.pincode === "string" ? req.query.pincode.trim() : "";
    const result = await checkDelivery(pincode);
    if (result.status === "invalid") {
        return res.status(400).json({ success: false, message: result.message });
    }
    res.set("Cache-Control", "no-store");
    // Provider trouble is reported in the body so the storefront can offer a retry without a failing network call.
    return res.status(result.status === DELIVERY_STATUS.UNAVAILABLE ? 503 : 200).json({ success: true, ...result });
};
