export const validateDeliveryAddress = address => {
    if (!address || typeof address !== "object" || Array.isArray(address)) {
        return "A delivery address is required.";
    }
    const required = ["firstName", "lastName", "email", "street", "city", "state", "zipcode", "country", "phone"];
    if (required.some(key => typeof address[key] !== "string" || !address[key].trim())) {
        return "Complete all required delivery address fields.";
    }
    const maxLengths = {
        firstName: 80, lastName: 80, email: 254, street: 300,
        city: 100, state: 100, zipcode: 6, country: 60, phone: 15
    };
    if (required.some(key => address[key].trim().length > maxLengths[key])) {
        return "One or more delivery address fields are too long.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email.trim())) {
        return "Enter a valid email address.";
    }
    if (!/^\d{6}$/.test(address.zipcode.trim())) {
        return "Enter a valid six-digit Indian PIN code.";
    }
    if (!/^(?:\+91[\s-]?)?[6-9]\d{9}$/.test(address.phone.replace(/[\s-]/g, ""))) {
        return "Enter a valid Indian mobile number.";
    }
    if (address.country.trim().toLowerCase() !== "india") {
        return "Delivery is currently available only within India.";
    }
    return null;
};

export const normalizeDeliveryAddress = address => ({
    firstName: address.firstName.trim(),
    lastName: address.lastName.trim(),
    email: address.email.trim().toLowerCase(),
    street: address.street.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    zipcode: address.zipcode.trim(),
    country: "India",
    phone: address.phone.trim()
});

export const calculateSubtotalPaise = items => {
    const subtotal = items.reduce((sum, item) => {
        if (!Number.isSafeInteger(item.unitPricePaise) || item.unitPricePaise < 0 ||
            !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
            throw Object.assign(
                new Error("Order items require non-negative paise prices and positive whole quantities."),
                { status: 400 }
            );
        }
        const lineTotal = item.unitPricePaise * item.quantity;
        if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(sum + lineTotal)) {
            throw Object.assign(new Error("Order total exceeds the supported amount."), { status: 400 });
        }
        return sum + lineTotal;
    }, 0);
    return subtotal;
};

export const calculateShippingPaise = (subtotalPaise, shipping = {}) => {
    if (!Number.isSafeInteger(subtotalPaise) || subtotalPaise < 0) {
        throw Object.assign(new Error("Order subtotal must be a non-negative integer amount in paise."), { status: 400 });
    }
    const feePaise = shipping.feePaise ?? 5000;
    const thresholdPaise = shipping.freeShippingThresholdPaise ?? null;
    if (!Number.isSafeInteger(feePaise) || feePaise < 0 ||
        (thresholdPaise !== null && (!Number.isSafeInteger(thresholdPaise) || thresholdPaise < 1))) {
        throw Object.assign(new Error("Shipping settings are invalid."), { status: 503 });
    }
    return thresholdPaise !== null && subtotalPaise >= thresholdPaise ? 0 : feePaise;
};
