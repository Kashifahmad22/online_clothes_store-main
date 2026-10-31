import { escapeHtml } from "../seo.js";

const PAYMENT_METHOD_LABELS = { COD: "Cash on delivery", Razorpay: "Online payment (Razorpay)" };
const PAYMENT_STATUS_LABELS = {
    cod_pending: "To be paid on delivery",
    pending: "Awaiting payment",
    authorized: "Authorised, awaiting capture",
    paid: "Paid",
    failed: "Payment failed",
    expired: "Payment window expired",
    refunded: "Refunded"
};

export const formatRupees = paise => {
    if (!Number.isFinite(paise)) return "";
    return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const linePaise = item => {
    const unit = Number.isSafeInteger(item.unitPricePaise)
        ? item.unitPricePaise
        : Math.round(Number(item.price) * 100);
    return Number.isFinite(unit) ? unit * (item.quantity || 1) : NaN;
};

export const orderTotalPaise = order => Number.isSafeInteger(order.totalPaise)
    ? order.totalPaise
    : Math.round(Number(order.amount) * 100);

const httpsUrl = value => {
    try {
        const url = new URL(String(value || ""));
        return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch {
        return "";
    }
};

export const paymentMethodLabel = order => PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod || "";
export const paymentStatusLabel = order => PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus || "";
export const orderReference = order => String(order._id);

const plain = value => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

const latestRefundPaise = order => {
    const refunds = order.refunds || [];
    return refunds.length ? refunds[refunds.length - 1].amountPaise : NaN;
};

const CONTENT = {
    order_placed: {
        subject: brand => `Your ${brand} order has been placed`,
        heading: "Thank you for your order",
        lead: () => "We have received your order and will update you as it progresses."
    },
    payment_success: {
        subject: brand => `Payment received for your ${brand} order`,
        heading: "Payment received",
        lead: order => order.status === "Cancelled"
            ? "We received your online payment after this order was cancelled. Our team will review it and contact you."
            : order.fulfillmentHold
            ? "Your online payment was verified. Our team is reviewing your order and will contact you if anything is needed."
            : "Your online payment was verified and your order is confirmed."
    },
    order_dispatched: {
        subject: brand => `Your ${brand} order has been dispatched`,
        heading: "Your order is on its way",
        lead: () => "Your order has been handed over for delivery."
    },
    out_for_delivery: {
        subject: brand => `Your ${brand} order is out for delivery`,
        heading: "Out for delivery",
        lead: () => "Your order is out for delivery."
    },
    order_delivered: {
        subject: brand => `Your ${brand} order has been delivered`,
        heading: "Order delivered",
        lead: () => "Your order has been marked as delivered."
    },
    return_approved: {
        subject: brand => `Your ${brand} return has been approved`,
        heading: "Return approved",
        lead: () => "Your return request has been approved."
    },
    refund_processed: {
        subject: brand => `Your ${brand} refund has been processed`,
        heading: "Refund processed",
        lead: order => {
            const amount = formatRupees(latestRefundPaise(order));
            return amount
                ? `A refund of ${amount} has been processed to your original payment method.`
                : "A refund has been processed to your original payment method.";
        }
    }
};

const shippingLines = order => {
    const shipping = order.shipping || {};
    const lines = [];
    if (shipping.courierName) lines.push(["Courier", plain(shipping.courierName)]);
    if (shipping.trackingNumber) lines.push(["Tracking number", plain(shipping.trackingNumber)]);
    return { lines, url: httpsUrl(shipping.trackingUrl) };
};

const supportLines = support => [
    support?.email && `Email: ${plain(support.email)}`,
    support?.phone && `Phone: ${plain(support.phone)}`,
    support?.whatsapp && `WhatsApp: ${plain(support.whatsapp)}`
].filter(Boolean);

export const buildEmail = (type, order, { brandName = "PSH Sarees & Ethnic Wear", support = {}, siteUrl = "" } = {}) => {
    const content = CONTENT[type];
    if (!content) throw new Error(`Unknown notification type: ${type}`);
    const brand = plain(brandName) || "PSH Sarees & Ethnic Wear";
    const subject = content.subject(brand);
    const name = plain(order.address?.firstName);
    const lead = content.lead(order);
    const reference = orderReference(order);
    const items = (order.items || []).map(item => ({
        name: plain(item.name),
        sku: plain(item.sku),
        quantity: item.quantity,
        total: formatRupees(linePaise(item))
    }));
    const facts = [
        ["Order number", reference],
        ["Payment method", paymentMethodLabel(order)],
        ["Payment status", paymentStatusLabel(order)]
    ];
    const tracking = ["order_dispatched", "out_for_delivery"].includes(type) ? shippingLines(order) : { lines: [], url: "" };
    facts.push(...tracking.lines);
    const totals = [];
    if (Number.isSafeInteger(order.subtotalPaise)) totals.push(["Subtotal", formatRupees(order.subtotalPaise)]);
    if (Number.isSafeInteger(order.shippingPaise)) totals.push(["Shipping", formatRupees(order.shippingPaise)]);
    totals.push(["Total", formatRupees(orderTotalPaise(order))]);
    const support$ = supportLines(support);
    const ordersUrl = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/orders` : "";
    const address = order.address || {};
    const destination = [address.city, address.state, address.zipcode].map(plain).filter(Boolean).join(", ");

    const text = [
        name ? `Hello ${name},` : "Hello,",
        "",
        lead,
        "",
        ...facts.map(([label, value]) => `${label}: ${value}`),
        ...(tracking.url ? [`Track your shipment: ${tracking.url}`] : []),
        "",
        "Items:",
        ...items.map(item => `- ${item.name}${item.sku ? ` (${item.sku})` : ""} x ${item.quantity}  ${item.total}`),
        "",
        ...totals.map(([label, value]) => `${label}: ${value}`),
        ...(destination ? ["", `Delivering to: ${destination}`] : []),
        ...(ordersUrl ? ["", `View your orders: ${ordersUrl}`] : []),
        ...(support$.length ? ["", "Need help?", ...support$] : []),
        "",
        brand
    ].join("\n");

    const row = ([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b5a4e;font-size:14px">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:14px;color:#2b1d17;text-align:right"><strong>${escapeHtml(value)}</strong></td></tr>`;
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f8f1e4;font-family:Arial,Helvetica,sans-serif;color:#2b1d17">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8f1e4"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e6d6b8">
<tr><td style="background:#5b1424;padding:20px 24px;color:#f8f1e4;font-size:18px;font-weight:bold;border-bottom:3px solid #b8923a">${escapeHtml(brand)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:22px;color:#5b1424">${escapeHtml(content.heading)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${name ? `Hello ${escapeHtml(name)}, ` : ""}${escapeHtml(lead)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #eee2c9;border-bottom:1px solid #eee2c9;margin:0 0 16px">${facts.map(row).join("")}</table>
${tracking.url ? `<p style="margin:0 0 16px"><a href="${escapeHtml(tracking.url)}" style="display:inline-block;background:#5b1424;color:#ffffff;text-decoration:none;padding:10px 18px;font-size:14px">Track your shipment</a></p>` : ""}
<h2 style="margin:0 0 8px;font-size:16px;color:#5b1424">Order summary</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items.map(item => `<tr><td style="padding:6px 8px 6px 0;font-size:14px;border-bottom:1px solid #f1e8d3">${escapeHtml(item.name)}${item.sku ? `<br><span style="color:#6b5a4e;font-size:12px">${escapeHtml(item.sku)}</span>` : ""}<br><span style="color:#6b5a4e;font-size:12px">Qty ${escapeHtml(item.quantity)}</span></td><td style="padding:6px 0;font-size:14px;text-align:right;border-bottom:1px solid #f1e8d3">${escapeHtml(item.total)}</td></tr>`).join("")}</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px">${totals.map(row).join("")}</table>
${destination ? `<p style="margin:16px 0 0;font-size:13px;color:#6b5a4e">Delivering to: ${escapeHtml(destination)}</p>` : ""}
${ordersUrl ? `<p style="margin:16px 0 0;font-size:13px"><a href="${escapeHtml(ordersUrl)}" style="color:#5b1424">View your orders</a></p>` : ""}
${support$.length ? `<p style="margin:20px 0 0;font-size:13px;color:#6b5a4e"><strong>Need help?</strong><br>${support$.map(escapeHtml).join("<br>")}</p>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;background:#faf5ea;font-size:12px;color:#6b5a4e">This is a transactional message about your order with ${escapeHtml(brand)}.</td></tr>
</table></td></tr></table></body></html>`;

    return { subject, text, html };
};

// Positional body parameters for the approved Meta templates; the mapping is documented in backend/README.md.
export const buildWhatsappParams = (type, order) => {
    const name = plain(order.address?.firstName) || "Customer";
    const reference = orderReference(order);
    const shipping = order.shipping || {};
    const params = {
        order_placed: [name, reference, formatRupees(orderTotalPaise(order)), paymentMethodLabel(order)],
        payment_success: [name, reference, formatRupees(orderTotalPaise(order))],
        order_dispatched: [name, reference, plain(shipping.courierName), plain(shipping.trackingNumber)],
        out_for_delivery: [name, reference],
        order_delivered: [name, reference],
        return_approved: [name, reference],
        refund_processed: [name, reference, formatRupees(latestRefundPaise(order))]
    }[type];
    if (!params) throw new Error(`Unknown notification type: ${type}`);
    return params.map(value => value || "-");
};
