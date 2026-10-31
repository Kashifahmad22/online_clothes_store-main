# PSH admin panel

The authenticated admin manages products, SKU inventory, orders and public storefront settings. Set `VITE_BACKEND_URL` in the admin environment file to the backend API base URL.

The **Storefront Settings** page edits public brand content, verified support/legal details, social and footer links, shipping fee/optional free-shipping threshold and copy, announcements and upcoming categories. It uses the existing admin-token authentication and the `/api/storefront/admin` endpoints. COD remains available; Razorpay, when fully configured, is restricted to test mode. Changing display settings does not enable payment or logistics functionality.

Use the existing Add Items form to create products. Sarees, suits, suit sets, dresses, suit pieces, lehengas and other ethnic-wear product types are supported; products remain subject to the existing image, variant, price, publication and stock validation.
