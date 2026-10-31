# PSH Sarees & Ethnic Wear storefront

The storefront reads published products, variants and public brand settings from the backend API. Product cards, category pages, festive collection pages, and product detail pages do not use sample catalogue data.

## Local configuration

Set `VITE_BACKEND_URL` in the frontend environment file to the backend base URL.

Customer support, legal seller information, footer links, social links, shipping fee/optional free-shipping threshold and message, announcement and upcoming categories are managed through the authenticated admin panel's **Storefront Settings**. Leave unverified details blank; the public footer hides empty fields. WhatsApp contact links are generated from the saved support number. Cart previews use the public settings; the server recalculates shipping for every order.

The checkout accepts an Indian PIN code but does not check logistics-provider serviceability. Its interface states this explicitly. COD is available. Razorpay checkout is conditionally available only when the backend reports complete test-mode configuration; live online payments are not enabled.

The Madhubani-inspired hero and footer artwork is original SVG/CSS artwork. Animations honor `prefers-reduced-motion`.

## Festive collections

Campaign metadata and shareable routes are defined in `src/config/campaigns.js`. To populate a campaign page, staff must assign the matching collection tag (`Dhanteras`, `Diwali`, or `Chhath`) to real products in the admin product form. The page will display an honest empty state until published products carry that tag. The configuration contains no discount, stock, or urgency claims.

Sarees, suits, suit sets and dresses are represented as product types. Collection pages only display matching published products; new types need no migration of existing catalogue data.

The production web host must serve `index.html` for client-side routes such as `/collections/diwali` and `/product/:slug`; no hosting provider is configured in this repository.
