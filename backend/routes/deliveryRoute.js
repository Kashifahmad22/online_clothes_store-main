import express from "express";
import { checkDeliveryAvailability } from "../controllers/deliveryController.js";
import { createDeliveryLimiter } from "../middleware/rateLimiters.js";

const deliveryRouter = express.Router();

deliveryRouter.get("/check", createDeliveryLimiter(), checkDeliveryAvailability);

export default deliveryRouter;
