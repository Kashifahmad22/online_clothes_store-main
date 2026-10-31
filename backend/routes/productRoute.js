import express from "express";
import {
    addProduct,
    listCatalogueFacets,
    listAdminProducts,
    listProducts,
    singleProduct,
    updateProduct,
    updateProductStatus
} from "../controllers/productController.js";
import upload from "../middleware/multer.js";
import adminAuth from "../middleware/adminAuth.js";

const productRouter = express.Router();

productRouter.get("/list", listProducts);
productRouter.get("/facets", listCatalogueFacets);
productRouter.get("/admin/list", adminAuth, listAdminProducts);
productRouter.get("/:productId", singleProduct);
productRouter.post("/add", adminAuth, upload.array("images", 12), addProduct);
productRouter.put("/:productId", adminAuth, upload.array("images", 12), updateProduct);
productRouter.patch("/:productId/status", adminAuth, updateProductStatus);

export default productRouter;
