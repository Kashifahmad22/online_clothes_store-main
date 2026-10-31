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
- `ADMIN_PASSWORD_HASH` (bcrypt hash, cost 10-15; production refuses to start without it. The plaintext `ADMIN_PASSWORD` variable is no longer read and should be deleted.)
- `TRUST_PROXY_HOPS` (**required in production**, integer 0-5; the server refuses to start without it. Optional in development, default 0. See below)
- `RAZORPAY_MODE=test`
- `RAZORPAY_KEY_ID` (test key ID beginning with `rzp_test_`)
- `RAZORPAY_KEY_SECRET` (server only)
- `RAZORPAY_WEBHOOK_SECRET` (server only; configure the same value in the Razorpay test-mode webhook)

### Admin password hash

Generate the hash locally (the password is typed without echo; only the hash is printed, and 72 bytes is the maximum):

```
npm run hash:admin-password
```

Store the printed value as `ADMIN_PASSWORD_HASH`. In a local `.env` file wrap it in single quotes because it contains `$`. Admin sign-in allows 5 failed attempts per client IP per 15 minutes; the limit expires on its own, so there is no permanent lockout. Counters are held in memory, which is appropriate for a single instance.

### Proxy trust and rate limiting

`TRUST_PROXY_HOPS` is the number of proxies in front of the app whose `X-Forwarded-For` entries are trusted. It must match the real deployment: too low and every visitor shares the proxy's rate-limit bucket; too high and clients can spoof their IP by sending their own `X-Forwarded-For`. `true` is never used. Verify a candidate value after deploying it:

1. Request `GET /api/product/facets` from two different networks and compare the `RateLimit` `r=` counters; each network must decrement independently.
2. Repeat with a forged `X-Forwarded-For: 203.0.113.9` header; the counter for your own network must keep decrementing as before (a separate counter means the value is too high).
3. Render logs must show no `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` or `ERR_ERL_PERMISSIVE_TRUST_PROXY` messages.

To establish the hop count, count the proxies between the internet and Node (for example Cloudflare, then Render's router). Confirm empirically rather than assuming: temporarily compare the `X-Forwarded-For` chain seen for a request from a known IP; the real client address must be the Nth entry from the right, where N is the value to set. Start with the lowest candidate and apply the verification steps above.

Rate-limit keys are IPv6-aware (`express-rate-limit` v8 `ipKeyGenerator`): IPv6 clients are grouped by /56 subnet, so rotating addresses inside a subnet does not bypass limits. IPv4-mapped IPv6 addresses share a bucket with the IPv4 address. Counters are in memory per instance and reset on restart.

The Razorpay webhook (`POST /api/order/razorpay/webhook`) is excluded from the general `/api` limiter and has its own limit of 120 requests per minute per client IP, applied before the body is read. Signature verification on the raw body and event-ID deduplication are unchanged.

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

## SEO, social previews and sitemap

Search and social metadata is derived from published products and the public storefront settings; nothing is stored separately.

- `SITE_URL` (optional, Render env var) is the canonical storefront origin used in the sitemap, crawler HTML and canonical URLs. It must be an `https://` origin (http is accepted only for localhost). If it is missing or invalid, the fallback in `utils/siteUrl.js` (the current Vercel URL) is used and an invalid value logs a warning. It is also returned to the storefront as `siteUrl` in `GET /api/storefront/public`.
- `GET /seo/product/:productId` returns lightweight HTML with Open Graph, Twitter, canonical and Product JSON-LD tags for a **published** product (by slug or ObjectId). Unknown, unpublished or malformed identifiers return a `noindex` 404 page, and database errors return 503 with `Retry-After`. Responses are `no-store`; only public product fields are used.
- `GET /sitemap.xml` lists the home page, public storefront pages, configured policy pages, category/collection pages and published products, with `lastmod` from `updatedAt`. Every published product is included: when there are more than 5,000 URLs, `/sitemap.xml` becomes a sitemap index pointing to `/sitemaps/1`, `/sitemaps/2`, … (5,000 URLs each, well under the 50,000 protocol limit); `/sitemaps/:page` returns 404 otherwise. Responses are cached briefly in memory. Database errors return 503, never a partial or empty sitemap.
- `frontend/vercel.json` proxies `/sitemap.xml`, `/sitemaps/:page` and, only for known social-crawler user agents (Facebook/Meta, WhatsApp, Twitter, LinkedIn, Telegram, Slack, Pinterest's crawler, Discord, Skype), `/product/:productId` to the routes above. Human visitors, in-app browsers and Googlebot continue to receive the React app (Googlebot renders JavaScript and reads the client-side tags and JSON-LD). The SPA catch-all must stay the last rewrite.

**Custom-domain checklist** — when the final domain is connected:

1. Set `SITE_URL` on Render to the new origin and redeploy the backend.
2. Update the `Sitemap:` line in `frontend/public/robots.txt`.
3. Update the backend host in the three rewrite destinations in `frontend/vercel.json` only if the Render URL changes (the CSP `connect-src` and backend `CORS` origins must also include the new storefront origin).

**Post-deploy verification**

```
curl -s -A "facebookexternalhit/1.1" https://<storefront>/product/<slug> | findstr /i "og: canonical ld+json"
curl -s -A "Mozilla/5.0" https://<storefront>/product/<slug>      # must be the normal React index.html
curl -s -o NUL -w "%{http_code}\n" -A "WhatsApp/2" https://<storefront>/product/does-not-exist   # 404
curl -s https://<storefront>/sitemap.xml
```

Then check a real product URL in the Facebook Sharing Debugger and by sending it in WhatsApp. Render free instances sleep when idle, so the first crawler request after a quiet period can time out and show no preview; re-sharing normally works once the service is awake.

## Order lifecycle and customer notifications

**Fulfilment status** (`order.status`) and **payment status** (`order.paymentStatus`) are independent.
Legal fulfilment transitions are enforced server-side in `utils/orderFulfillment.js`:
`Order Placed → Processing → Packing → Packed → Shipped → Out for delivery → Delivered → Return Requested → Return Approved`
(`Processing` and `Packing` are optional steps; `Packing` must go through `Packed` before `Shipped`.
`Return Requested → Delivered` is allowed if the request is rejected). Cancellation is only possible before dispatch
(`Order Placed`, `Processing`, `Packing`, `Packed`); `Shipped`, `Out for delivery` and `Delivered` orders cannot be cancelled.
`Cancelled` and `Return Approved` are terminal. Prepaid orders cannot enter a physical status until payment is verified
and not on review hold.
`Shipped` never becomes `Delivered` automatically, and `Shipped` requires courier and tracking details.
Every change is appended to `order.statusHistory` with a timestamp and actor (`admin`, `customer` or `system`; the admin
API has a single shared admin role, so individual admins are not distinguished).

- COD stays `cod_pending` until an admin uses *Mark COD cash as collected* (only after `Delivered`).
- Prepaid orders become `paid` only after verified Razorpay capture (client verification or signed webhook).
- A refund is recorded only from a signed `refund.processed` webhook, never from an admin request. `refunded` is set
  only when the cumulative processed refunds equal the order total. **Subscribe the Razorpay webhook to `refund.processed`**
  (Razorpay dashboard setting, not changed by this code), and issue refunds from the Razorpay dashboard.
- There is no customer self-service return flow: the return window and eligibility are business decisions. Admins can set
  `Return Requested` / `Return Approved`. Approving a return does not restore stock automatically.

### Notifications

Events: order placed (COD), payment successful (prepaid), dispatched, out for delivery, delivered, return approved,
refund processed. Delivery can never fail or undo an order, payment or admin update.

**Transactional outbox.** The `NotificationEvent` document is written *inside the same MongoDB transaction* as the order
change (COD placement, verified payment/webhook, admin status update, processed refund), using an upsert on the unique
`dedupeKey`. The order change and its event therefore commit or roll back together. Nothing is sent inside a transaction
(transactions can retry); the transaction only writes the event. If the event write itself fails, the whole transaction
aborts: for COD checkout the customer sees a retryable error, and for a Razorpay webhook the provider is asked to redeliver.
After commit, a best-effort nudge triggers delivery, and a background worker (`startNotificationWorker`, started in
`server.js`) scans MongoDB every 60 seconds and once at startup, so events left pending by a crash or restart are found
without any in-memory state.

- **Idempotency:** unique `dedupeKey` (`orderId:type[:refundId]`). Repeated webhooks, duplicate verifications or
  transaction retries do not create new events.
- **Per-channel state:** `email` and `whatsapp` each track `pending | sent | failed | skipped`, attempts and the last
  error *code* (no addresses, phone numbers, message bodies or credentials are stored or logged). A failure on one channel
  never blocks the other.
- **Retry:** temporary failures (timeouts, 429, 5xx) back off 1 min, 5 min, 30 min, 2 h, 6 h (5 attempts); permanent
  failures end as `failed`. Each channel is claimed atomically (conditional update with a 2-minute lock) before sending.
- **Skipped** channels (provider or template not configured, no valid recipient, no WhatsApp opt-in) are not retried
  automatically; admins can retry them from the order page after fixing the cause. A manual retry resets the attempt count.
- **Delivery guarantee: at-least-once, not exactly-once.** A provider can accept a message just before the process crashes
  or before its state is saved, leaving delivery uncertain; after the 2-minute lock expires the worker may send it again.
  The code cannot remove this window, only narrow it.
- The worker runs inside the Render web process, so a sleeping free-tier instance delays delivery until it wakes.
- `server.js` awaits `notificationEventModel.init()` before accepting traffic, which creates the collection and builds the
  unique `dedupeKey` index. Startup fails if this cannot complete (for example the database user lacks `createIndex`
  permission), rather than running without duplicate protection. Verify this on the production cluster before launch.

### Email (SMTP via nodemailer)

Set `SMTP_HOST`, `EMAIL_FROM` (required) and `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`. Support contact details
appear in emails only if configured in storefront settings. No email address is invented.

### WhatsApp (Meta Cloud API)

No WhatsApp integration existed before this phase. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, optionally
`WHATSAPP_API_VERSION` and `WHATSAPP_TEMPLATE_LANGUAGE`, plus one **approved utility template name** per event
(`WHATSAPP_TEMPLATE_ORDER_PLACED`, `_PAYMENT_SUCCESS`, `_ORDER_DISPATCHED`, `_OUT_FOR_DELIVERY`, `_ORDER_DELIVERED`,
`_RETURN_APPROVED`, `_REFUND_PROCESSED`). Only template messages are sent. An event with no template is skipped.
Body parameters, in order:

| Template | `{{1}}` | `{{2}}` | `{{3}}` | `{{4}}` |
|---|---|---|---|---|
| order_placed | customer name | order reference | total | payment method |
| payment_success | customer name | order reference | amount paid | |
| order_dispatched | customer name | order reference | courier | tracking number |
| out_for_delivery, order_delivered, return_approved | customer name | order reference | | |
| refund_processed | customer name | order reference | refund amount | |

Use these only for transactional (utility) templates, never marketing. WhatsApp is sent **only** to customers who ticked the
unchecked-by-default "Send my order updates on WhatsApp" box at checkout (`order.whatsappOptIn`, with `whatsappOptInAt`);
orders without it, including all orders placed before this change, are skipped as `no_opt_in`. Confirm your own consent and
policy requirements with Meta before enabling WhatsApp.

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
