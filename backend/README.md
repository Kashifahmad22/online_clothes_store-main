# Backend catalogue and checkout

The backend is an Express API backed by MongoDB/Mongoose. Checkout supports COD and optional Razorpay **test mode**. Live Razorpay credentials are deliberately rejected; online payment remains unavailable until complete test-mode configuration is present.

## Required configuration

Configure these values in the backend deployment environment; never put server secrets in a `VITE_` variable:

- `MONGODB_URI`
- `JWT_SECRET` (at least 32 characters)
- `CORS_ORIGINS` (comma-separated exact storefront/admin origins in production)
- `CLOUDINARY_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_SECRET_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `RAZORPAY_MODE=test`
- `RAZORPAY_KEY_ID` (test key ID beginning with `rzp_test_`)
- `RAZORPAY_KEY_SECRET` (server only)
- `RAZORPAY_WEBHOOK_SECRET` (server only; configure the same value in the Razorpay test-mode webhook)

Order placement uses MongoDB transactions to make inventory decrement and order creation atomic. Use a replica-set-enabled MongoDB deployment. If transaction support is unavailable, the API fails the order rather than risking a partial stock/order update.

Prepaid checkout also requires MongoDB transactions. The backend reserves available SKU inventory for 15 minutes, creates the provider order using the server-calculated INR total, and confirms only captured payments with a verified checkout signature and a server-side payment lookup. Authorized payments are not treated as paid. Duplicate webhook events are deduplicated by provider event ID; payment capture and order-paid events are handled idempotently. A captured payment after its reservation has expired is put on fulfilment hold for manual review and must not be dispatched.

Configure a Razorpay webhook in **test mode** for `payment.authorized`, `payment.failed`, `payment.captured`, and `order.paid`, targeting `/api/order/razorpay/webhook`. Keep automatic capture enabled in the Razorpay dashboard. COD remains available independently. Never place payment secrets in a `VITE_` variable or expose them to the browser. Do not configure live credentials in this phase.

The storefront requests a provider order from the authenticated backend and receives only the public test key ID, server-calculated paise amount, provider order ID, and delivery prefill. The browser callback is not treated as proof of payment: the backend verifies the callback signature and fetches the payment from Razorpay before confirming it. Captured-payment webhooks use the raw request body and are deduplicated by event ID. Failed payments release the reservation; a retry first reacquires the same SKU quantities atomically and starts a fresh reservation window. A late capture after stock has been released is held from fulfilment for review. Payment and fulfilment states are visible in customer and admin order lists.

Use this flow only on a non-production test deployment with Razorpay test credentials. Confirm automatic capture and webhook delivery there, then verify successful, failed, duplicate, and late-capture handling without using live keys. The application intentionally rejects live-mode credentials; no production payment launch or real-charge test is supported by this phase. Adding the payment fields is additive, and existing orders remain readable without a data migration.

Admins can manage manual fulfilment from the Orders page. Order transitions are validated server-side; Razorpay orders must be captured and not on review hold before processing or dispatch. Courier name and tracking number are required before marking an order shipped; a supplied tracking link must use HTTPS. Cancelling an unpaid prepaid order releases its reservation, while COD cancellation before dispatch restores stock transactionally. Paid prepaid cancellations are blocked until a refund workflow exists. Customer order history displays the supplied tracking details. Email or WhatsApp notifications are not configured and are not claimed as sent.

`GET /health` reports `200` only when the MongoDB connection is ready and `503` otherwise. The backend waits for MongoDB before opening its HTTP listener. Set `PORT` to the port assigned by the hosting platform; local development defaults to `4000`.

The existing ₹50 delivery charge remains the default. Authenticated administrators can configure the shipping fee and an optional free-shipping threshold in Storefront Settings; the backend recalculates both against the order subtotal when creating an order. Confirm the actual shipping policy before accepting production orders.

## Storefront brand settings API

The singleton storefront settings document is created on the first successful admin save; no migration is required. The model stores only customer-facing settings. Server credentials and other private configuration are not part of this document or either settings response.

- `GET /api/storefront/public` — public, read-only settings used by the storefront.
- `GET /api/storefront/admin` — authenticated admin read of the same editable settings.
- `PUT /api/storefront/admin` — authenticated admin update; validates content, links and field lengths.

All admin routes require the existing admin token header. Public responses are explicitly allow-listed. Checkout capability is server-defined: COD is enabled, and prepaid availability is true only when complete Razorpay test-mode configuration is present; storefront settings cannot enable payment or shipping integrations. The configured shipping fee and optional threshold are public for cart previews and are always recalculated by the order API.

Product types `suit`, `suit-set`, and `dress` were added to the existing type enum. This is additive and requires no data migration; existing product records and SKU inventory are unchanged.

The settings document supports public brand name, tagline, description and logo URL; support contacts and hours; legal seller name, GSTIN, registered address and grievance information; social and footer links; shipping information; announcements; footer artwork selection; and upcoming categories. Optional unconfigured values should remain empty so they are not shown to customers.

## Legacy catalogue migration

Back up the database before migrating. First report the proposed conversion without writing:

```powershell
npm run migrate:catalogue
```

Review the report, then explicitly apply it:

```powershell
npm run migrate:catalogue -- --apply
```

Legacy products remain drafts with zero stock until an administrator reviews product details and confirms actual inventory. Existing product image URLs and product text are retained where valid. The script maps old size keys in customer carts to generated legacy SKUs where possible. Do not publish migrated products until their data and stock are verified.

## Validation

Run backend unit tests with:

```powershell
npm test
```
