export const PRODUCT_STATUSES = ["draft", "published", "archived"];

// An archived product must be restored to Draft before it can be published again.
const ALLOWED_TRANSITIONS = {
    draft: ["published", "archived"],
    published: ["draft", "archived"],
    archived: ["draft"]
};

export const isAllowedStatusTransition = (from, to) =>
    from === to || ALLOWED_TRANSITIONS[from]?.includes(to) === true;

export const assertStatusTransition = (from, to) => {
    if (!PRODUCT_STATUSES.includes(to)) {
        throw Object.assign(new Error("Product status must be draft, published, or archived."), { status: 400 });
    }
    if (isAllowedStatusTransition(from, to)) return;
    const message = from === "archived" && to === "published"
        ? "Restore an archived product to Draft before publishing it."
        : `A ${from} product cannot be changed to ${to}.`;
    throw Object.assign(new Error(message), { status: 400 });
};

// A normal edit keeps the stored status unless the payload explicitly asks for a supported change.
export const resolveStatusForEdit = (currentStatus, requestedStatus) => {
    const current = PRODUCT_STATUSES.includes(currentStatus) ? currentStatus : "draft";
    if (requestedStatus === undefined) return current;
    assertStatusTransition(current, requestedStatus);
    return requestedStatus;
};
