import express from "express";
import authUser from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { reviewImages } from "../middleware/reviewUpload.js";
import { createReviewLimiter } from "../middleware/rateLimiters.js";
import {
    listProductReviews, getMyReview, submitReview, updateMyReview,
    adminListReviews, adminGetReview, adminModerateReview, adminImportReview
} from "../controllers/reviewController.js";

const reviewRouter = express.Router();

reviewRouter.get("/admin/list", adminAuth, adminListReviews);
reviewRouter.post("/admin/import", adminAuth, adminImportReview);
reviewRouter.get("/admin/:id", adminAuth, adminGetReview);
reviewRouter.patch("/admin/:id/moderate", adminAuth, adminModerateReview);

reviewRouter.get("/mine/:productId", authUser, getMyReview);
reviewRouter.get("/product/:productId", listProductReviews);
reviewRouter.post("/product/:productId", authUser, createReviewLimiter(), reviewImages, submitReview);
reviewRouter.put("/product/:productId", authUser, createReviewLimiter({ limit: 20 }), updateMyReview);

export default reviewRouter;
