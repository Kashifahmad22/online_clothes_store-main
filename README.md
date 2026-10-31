# PSH Sarees & Ethnic Wear

PSH is an online catalogue and ecommerce application for sarees and ethnic wear. The storefront uses published products and variant inventory from MongoDB; it does not use sample catalogue data. Cash on delivery is available. Razorpay Standard Checkout is restricted to test mode and is shown only when complete test credentials and webhook configuration are present. Live payments and shipping-provider integrations are not enabled.

## Applications

- `frontend/` — React + Vite customer storefront.
- `admin/` — React + Vite authenticated catalogue, order, and storefront-settings panel.
- `backend/` — Express API, MongoDB/Mongoose catalogue and order services, and Cloudinary product-image uploads.

## Local development

Configure the environment files for the backend, frontend and admin as described in their READMEs. Start each application from its own directory:

```powershell
cd backend
npm run start
```

```powershell
cd frontend
npm run dev
```

```powershell
cd admin
npm run dev
```

The default development URLs are `http://localhost:4000` for the API, `http://localhost:5173` for the storefront, and `http://localhost:5174` for the admin panel.

## Catalogue and storefront configuration

Administrators can edit public brand, customer-support, seller/legal, social-link, footer, shipping-message, announcement, and upcoming-category details under **Storefront Settings**. Unconfigured optional information is omitted from the public site. Checkout capability is not editable there: COD remains available, while online checkout is test-mode-only and requires complete backend Razorpay configuration.

New product types (`suit`, `suit-set`, `dress`) are additive; existing product documents and variant SKUs require no migration. Categories appear in storefront navigation when published catalogue products use them.

See the application READMEs for backend configuration and API details. Run backend tests with `npm test` from `backend/`.
