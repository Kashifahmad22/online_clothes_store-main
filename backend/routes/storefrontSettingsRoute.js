import express from "express";
import adminAuth from "../middleware/adminAuth.js";
import {
    getAdminStorefrontSettings,
    getPublicStorefrontSettings,
    updateStorefrontSettings
} from "../controllers/storefrontSettingsController.js";

const storefrontSettingsRouter = express.Router();

storefrontSettingsRouter.get("/public", getPublicStorefrontSettings);
storefrontSettingsRouter.get("/admin", adminAuth, getAdminStorefrontSettings);
storefrontSettingsRouter.put("/admin", adminAuth, updateStorefrontSettings);

export default storefrontSettingsRouter;
