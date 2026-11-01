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

The storefront requests a provider order from the authenticated backend and receives only the public test key ID, server-calculated paise amount, provider order ID, and delivery prefill. The browser callback is not treated as proof of payment: the backend verifies the callback signature and fetches the payment from Razorpay before confirming it. Captured-payment webhooks use the raw request body and are deduplicated by event ID. Failed payment attempts are recorded (`paymentStatus: failed`) but never release stock or extend the deadline: the customer may keep paying inside the same Razorpay order until the original reservation expires. Only the expiry sweeper releases an expired reservation. Retrying a failed order keeps the existing reservation; if it was already released, the retry re-reserves every SKU atomically (or fails with `INSUFFICIENT_STOCK`) and starts a fresh window. Payment and fulfilment states are visible in customer and admin order lists. See "Prepaid payment state machine" below.

Use this flow only on a non-production test deployment with Razorpay test credentials. Confirm automatic capture and webhook delivery there, then verify successful, failed, duplicate, and late-capture handling without using live keys. The application intentionally rejects live-mode credentials; no production payment launch or real-charge test is supported by this phase. Adding the payment fields is additive, and existing orders remain readable without a data migration.

Admins can manage manual fulfilment from the Orders page. Order transitions are validated server-side; Razorpay orders must be captured and not on review hold before processing or dispatch. Courier name and tracking number are required before marking an order shipped; a supplied tracking link must use HTTPS. Cancelling an unpaid prepaid order releases its reservation and closes it for payment. A paid prepaid cancellation is permitted only for an order already on a stock-not-deducted review hold; it takes no stock, is flagged for review and is never marked refunded. Otherwise it is blocked with `PAID_ORDER_REQUIRES_REFUND` until a refund workflow exists. COD cancellation before dispatch restores stock transactionally. Customer order history displays the supplied tracking details. Email or WhatsApp notifications are not configured and are not claimed as sent.

`GET /health` reports `200` only when the MongoDB connection is ready and `503` otherwise. The backend waits for MongoDB before opening its HTTP listener. Set `PORT` to the port assigned by the hosting platform; local development defaults to `4000`.

The existing â‚¹50 delivery charge remains the default. Authenticated administrators can configure the shipping fee and an optional free-shipping threshold in Storefront Settings; the backend recalculates both against the order subtotal when creating an order. Confirm the actual shipping policy before accepting production orders.

## Storefront brand settings API

The singleton storefront settings document is created on the first successful admin save; no migration is required. The model stores only customer-facing settings. Server credentials and other private configuration are not part of this document or either settings response.

- `GET /api/storefront/public` â€” public, read-only settings used by the storefront.
- `GET /api/storefront/admin` â€” authenticated admin read of the same editable settings.
- `PUT /api/storefront/admin` â€” authenticated admin update; validates content, links and field lengths.

All admin routes require the existing admin token header. Public responses are explicitly allow-listed. Checkout capability is server-defined: COD is enabled, and prepaid availability is true only when complete Razorpay test-mode configuration is present; storefront settings cannot enable payment or shipping integrations. The configured shipping fee and optional threshold are public for cart previews and are always recalculated by the order API.

Product types `suit`, `suit-set`, and `dress` were added to the existing type enum. This is additive and requires no data migration; existing product records and SKU inventory are unchanged.

The settings document supports public brand name, tagline, description and logo URL; support contacts and hours; legal seller name, GSTIN, registered address and grievance information; social and footer links; shipping information; announcements; footer artwork selection; and upcoming categories. Optional unconfigured values should remain empty so they are not shown to customers.

## SEO, social previews and sitemap

Search and social metadata is derived from published products and the public storefront settings; nothing is stored separately.

- `SITE_URL` (optional, Render env var) is the canonical storefront origin used in the sitemap, crawler HTML and canonical URLs. It must be an `https://` origin (http is accepted only for localhost). If it is missing or invalid, the fallback in `utils/siteUrl.js` (the current Vercel URL) is used and an invalid value logs a warning. It is also returned to the storefront as `siteUrl` in `GET /api/storefront/public`.
- `GET /seo/product/:productId` returns lightweight HTML with Open Graph, Twitter, canonical and Product JSON-LD tags for a **published** product (by slug or ObjectId). Unknown, unpublished or malformed identifiers return a `noindex` 404 page, and database errors return 503 with `Retry-After`. Responses are `no-store`; only public product fields are used.
- `GET /sitemap.xml` lists the home page, public storefront pages, configured policy pages, category/collection pages and published products, with `lastmod` from `updatedAt`. Every published product is included: when there are more than 5,000 URLs, `/sitemap.xml` becomes a sitemap index pointing to `/sitemaps/1`, `/sitemaps/2`, â€¦ (5,000 URLs each, well under the 50,000 protocol limit); `/sitemaps/:page` returns 404 otherwise. Responses are cached briefly in memory. Database errors return 503, never a partial or empty sitemap.
- `frontend/vercel.json` proxies `/sitemap.xml`, `/sitemaps/:page` and, only for known social-crawler user agents (Facebook/Meta, WhatsApp, Twitter, LinkedIn, Telegram, Slack, Pinterest's crawler, Discord, Skype), `/product/:productId` to the routes above. Human visitors, in-app browsers and Googlebot continue to receive the React app (Googlebot renders JavaScript and reads the client-side tags and JSON-LD). The SPA catch-all must stay the last rewrite.

**Custom-domain checklist** â€” when the final domain is connected:

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
`Order Placed â†’ Processing â†’ Packing â†’ Packed â†’ Shipped â†’ Out for delivery â†’ Delivered â†’ Return Requested â†’ Return Approved`
(`Processing` and `Packing` are optional steps; `Packing` must go through `Packed` before `Shipped`.
`Return Requested â†’ Delivered` is allowed if the request is rejected). Cancellation is only possible before dispatch
(`Order Placed`, `Processing`, `Packing`, `Packed`); `Shipped`, `Out for delivery` and `Delivered` orders cannot be cancelled.
`Cancelled` and `Return Approved` are terminal. Prepaid orders cannot enter a physical status until payment is verified
and not on review hold.
`Shipped` never becomes `Delivered` automatically, and `Shipped` requires courier and tracking details.
Every change is appended to `order.statusHistory` with a timestamp and actor (`admin`, `customer` or `system`; the admin
API has a single shared admin role, so individual admins are not distinguished).

- COD stays `cod_pending` until an admin uses *Mark COD cash as collected* (only after `Delivered`).
- Prepaid orders become `paid` only after verified Razorpay capture (client verification or signed webhook).
- A refund is marked `processed` only on gateway evidence: a signed `refund.processed` webhook or a Razorpay fetch that
  reports it processed, never the response to the create call. `refunded` is set only when processed refunds equal the order
  total. See *Refunds and reconciliation* below. **Subscribe the Razorpay webhook to `refund.created`, `refund.processed`
  and `refund.failed`** (a dashboard setting this code does not change).
- There is no customer self-service return flow: the return window and eligibility are business decisions. Admins can set
  `Return Requested` / `Return Approved`. Approving a return does not restore stock automatically.

### Prepaid payment state machine

Policy lives in `utils/paymentStateMachine.js`; every path (client verification, webhooks, retry, admin cancellation,
expiry sweeper) goes through it and an illegal move throws `INVALID_PAYMENT_TRANSITION`.

| From | Allowed to |
|------|-----------|
| `pending` | `authorized`, `failed`, `expired`, `paid` |
| `authorized` | `failed`, `expired`, `paid` |
| `failed` | `pending` (retry), `authorized`, `expired`, `paid` |
| `expired` | `paid` (late capture only) |
| `paid` | `refunded` (only from a signed `refund.processed` webhook) |
| `refunded` | none |

- **Failed payment:** recorded, but stock stays reserved and the deadline is unchanged. A late or out-of-order `failed`
  event never overrides `paid`, or a newer authorised attempt. Duplicate events are no-ops.
- **Expiry:** only the sweeper releases an expired reservation (`pending`/`failed` â†’ `expired`).
- **Late capture:** amount, currency, Razorpay order and payment id are revalidated. A held reservation is settled
  atomically. If it was released, stock is re-acquired only by a conditional atomic update in the same transaction;
  if that fails the order is `paid` but on a review hold (`stock_unavailable`) and is not fulfilled. A capture on a
  cancelled order is kept as evidence with an `order_cancelled` review and takes no stock. A second distinct captured
  payment is recorded in `duplicatePaymentIds` with a `duplicate_payment` review and takes no stock.
- **Retry restrictions:** retry and idempotent create-replay refuse cancelled (`ORDER_CANCELLED`), paid/refunded
  (`ORDER_ALREADY_PAID`), non-`Order Placed` (`ORDER_NOT_PAYABLE`), reviewed (`PAYMENT_REVIEW_REQUIRED`), expired
  (`PAYMENT_WINDOW_EXPIRED`) and in-progress (`PAYMENT_IN_PROGRESS`) orders with HTTP 409.
- **Review holds:** `fulfillmentHold` plus `paymentReviewReason` (`stock_unavailable`, `inventory_conflict`,
  `order_cancelled`, `duplicate_payment`, `authorized_on_closed_order`). Customers see only that the order is under review.
- **Admin resolution (`POST /api/order/payment-review`, admin token required):** `release` needs a captured payment with a
  payment id, an uncancelled `Order Placed` order and a stock-not-deducted reason; it re-acquires stock atomically and
  fails with `STOCK_UNAVAILABLE` (hold kept) otherwise. `acknowledge` is refused for stock holds on live orders. Both
  need a 5â€“120 character reason and are written to the status history with the actor. A repeat call returns
  `NO_REVIEW_PENDING`, so stock cannot be deducted twice. Resolving a hold never issues a refund; refunds are a separate
  admin action (below). The admin
  Orders page shows review details read-only; the resolve action is API-only (UI is an outstanding Phase 9.8 item).
- Behaviour under real MongoDB transactions and real Razorpay event ordering is not covered by the automated tests.

### Refunds and reconciliation (Phase 9.7)

**Refund states** (per refund record, integer paise): `requested` (stored, Razorpay has not acknowledged it, or the outcome
is unknown after a timeout) â†’ `pending` (Razorpay acknowledged) â†’ `processed` | `failed`. A record only moves forward;
`processed` is terminal and never downgraded by a late or duplicate event; `failed` may become `processed` because
Razorpay is the authority. Records written before this phase have no status and count as `processed`.
Requested and pending amounts count against the refundable balance, so refunds cannot exceed the captured amount in total.
`paymentStatus` becomes `refunded` only when processed refunds equal the order total. A refund never restocks inventory and
never clears a review hold.

**Initiating (`POST /api/order/refund`, admin token):** body `{orderId, amountPaise, reason, idempotencyKey (uuid), paymentId?}`.
The server re-fetches the payment from Razorpay (captured, same order, amount and currency, enough unrefunded balance),
stores a `requested` record in a transaction, then calls Razorpay. The create response only moves it to `pending`. A
definitive 4xx records `failed`; a timeout/5xx leaves it `requested` and returns `202 REFUND_OUTCOME_UNCERTAIN`, and further
refunds on that payment are blocked (`REFUND_IN_DOUBT`) until it is resolved.
**Idempotency:** a repeated `idempotencyKey` replays the stored record and never contacts Razorpay again (a different
amount returns `IDEMPOTENCY_KEY_REUSED`). The Razorpay SDK in use (2.9.8) has no idempotency header, so the record's internal
id is sent as `receipt` and `notes.pshRefundId`; `POST /api/order/refund/sync` (admin) looks a lost request up by that id
instead of resubmitting, and fails a `requested` record only if Razorpay has none after 30 minutes.

**Webhooks** (signature verified on the raw body, event ids deduplicated): `refund.created`, `refund.processed`,
`refund.failed`. The payload's own refund status is used (the event name only as a fallback). A refund must match the order's
payment id, amount and currency (and the recorded request, if any). A refund for a payment on no order, or one that does not
match, is not applied and is preserved in the `paymentanomalies` collection. Event names follow Razorpay's documented
catalogue and must be confirmed against real test-mode deliveries.

**Reconciliation** (`utils/paymentReconciliation.js`): finds Razorpay orders created within a bounded window (default 72 h,
max 168 h) that are `pending`/`authorized`/`failed`/`expired`, plus paid orders on hold, oldest-attempted first, at most
`limit` (default 25, max 100) per run. For each it calls Razorpay's order-payments API (10 s timeout), validates every
captured payment's id, order, amount and currency, and settles valid ones through the same `settleCapturedPayment` path as
the webhook, so repeated runs never deduct stock twice. Mismatched captures are never settled: they are stored as anomalies
and flag `payment_mismatch` for review. Paid orders on hold are only reported (`needs_review`), never cleared. A 429 aborts
the run. Gateway errors and incomplete evidence leave the order unchanged. Each attempt is stored on the order
(`reconciliation`) and each run in `reconciliationruns`. A lease lock (`reconciliationlocks`, 5 min) stops overlapping runs.
It also re-checks a bounded number of in-flight refunds.

- **Admin:** *Reconcile payments with Razorpay* on the Orders page (`POST /api/order/reconcile`, admin token; optional
  `orderId` targets one order for recovery).
- **External scheduler (not active):** `POST /api/order/reconcile/scheduled` with header `x-reconcile-token` equal to the
  `RECONCILIATION_JOB_TOKEN` environment variable (at least 32 characters). Until that variable is set the endpoint returns 503.
  No scheduler is configured by this repository; use e.g. a Render cron job or an external HTTP scheduler. The existing 60 s
  in-process interval only releases expired reservations.
- **Manual recovery:** an unconfirmed (`requested`) refund â†’ *Check refund status*; a `payment_mismatch`, duplicate or
  cancelled-order late capture â†’ refund the specific payment from the Payment review panel (Phase 9.8).
- **Not verified here:** all tests use mocks. Real MongoDB transaction behaviour, Razorpay event ordering and the exact refund
  response/webhook shapes still need test-mode verification.

### Payment exceptions and admin recovery (Phase 9.8)

- **Payment Exceptions page (admin):** lists `paymentanomalies` (open / under investigation / resolved) and the ten most
  recent reconciliation runs, with a manual *Run reconciliation now* button that stays disabled while a run is in progress.
  No automatic scheduler is configured. Endpoints (all admin-authenticated `POST`): `/api/order/anomalies`,
  `/api/order/anomalies/status`, `/api/order/reconcile/history`, `/api/order/payment-review/detail`.
- **Anomaly status:** `open â†’ investigating | resolved`, `investigating â†’ open | resolved`, `resolved â†’ open`. A reason of 5â€“120
  characters is required and each change appends an audit entry. A concurrent change returns 409 `STATUS_CHANGED`. Changing an
  anomaly status never touches payment status, stock, refunds or fulfilment.
- **Review resolution (`POST /api/order/payment-review`):** `release` re-reserves stock atomically and deducts it once;
  `acknowledge` clears a review that has no stock effect. The detail endpoint reports whether each is allowed and why not.
  Acknowledge is refused with `ACKNOWLEDGE_NOT_ALLOWED` (stock-unavailable on a live order), `REFUND_REQUIRED` (cancelled
  order whose payment is not confirmed refunded), `ADDITIONAL_PAYMENT_UNREFUNDED` (an extra captured payment still has money
  not confirmed refunded) and `MISMATCH_UNRESOLVED` (open mismatch anomalies). There is no action that only clears the hold.
- **Payment-specific refunds:** `POST /api/order/refund` accepts `paymentId`. The payment is fetched from Razorpay and must be
  captured, in INR, for a positive amount and belong to the order's Razorpay order. It is recorded in `capturedPayments` and
  accounted separately; the cap is that payment's own remaining balance. A non-primary payment is accepted only while the
  order is under payment review or the payment is already a registered duplicate/captured payment. Refunds never clear a hold or
  restock, and the order becomes `refunded` only when every registered captured payment is confirmed fully refunded
  (webhook or verified sync). Legacy `duplicatePaymentIds` without a `capturedPayments` entry use the order total as their
  captured amount and do not block the order-level refunded decision.
- **Cart preservation:** a settled order removes only the purchased quantities from the server cart (conditional per-variant
  updates, run once per settlement because the `paid` state returns early). Items or quantities added afterwards stay. The
  storefront reloads the server cart instead of clearing it.
- **Checkout refresh recovery:** the storefront keeps only an idempotency key and order id in `sessionStorage`. After a refresh it
  reads the order list from the server and resumes payment only for a Razorpay order that is pending, reserved, unexpired and
  not on hold; otherwise the stored attempt is discarded. Expired or cancelled Razorpay orders are never reused.
- **Customer wording:** orders expose a coarse `paymentIssue` (`review`, `stock`, `cancelled_capture`, `duplicate`) and
  refund status. No gateway text, anomaly ids or payment ids are exposed, and no retry is offered while a capture is held.
- **Limitations:** the admin JWT carries no admin identity, so audit entries record the actor as `admin`. All tests use mocks;
  real MongoDB transactions and Razorpay payment/refund responses still need test-mode verification.

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

## Delivery PIN-code checker

`GET /api/delivery/check?pincode=NNNNNN` is public and rate-limited. With no provider configured it returns `manual_confirmation` and never a date. Setting `DELIVERY_PROVIDER=shiprocket` plus `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` and `DELIVERY_PICKUP_PINCODE` enables the Shiprocket lookup (`DELIVERY_HANDLING_DAYS` adds your dispatch time to courier estimates). **The Shiprocket request/response handling is implemented from its documented shape but has NOT been verified against the live API**; test it with real credentials before relying on it. Provider failures return `unavailable` (HTTP 503), never serviceable.
