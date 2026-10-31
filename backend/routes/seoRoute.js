import express from "express";
import { productPreview, sitemap, sitemapPage } from "../controllers/seoController.js";

// Public, read-only, crawler-facing endpoints. They live outside /api so the storefront can
// proxy them through Vercel rewrites without exposing any API route.
const seoRouter = express.Router();

seoRouter.get("/sitemap.xml", sitemap);
seoRouter.get("/sitemaps/:page", sitemapPage);
seoRouter.get("/seo/product/:productId", productPreview);

export default seoRouter;
