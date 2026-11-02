import multer from "multer";
import os from "node:os";
import { MAX_REVIEW_IMAGES, MAX_REVIEW_IMAGE_BYTES, REVIEW_IMAGE_TYPES } from "../utils/reviews.js";

const uploader = multer({
    storage: multer.diskStorage({ destination: os.tmpdir() }),
    limits: { fileSize: MAX_REVIEW_IMAGE_BYTES, files: MAX_REVIEW_IMAGES, fields: 10 },
    fileFilter: (_req, file, cb) => cb(null, REVIEW_IMAGE_TYPES.has(file.mimetype))
});

// Converts multer limit errors into a normal JSON 400 instead of a 500.
export const reviewImages = (req, res, next) => {
    uploader.array("images", MAX_REVIEW_IMAGES)(req, res, error => {
        if (!error) return next();
        const message = error.code === "LIMIT_FILE_SIZE" ? "Each photo must be 5 MB or smaller."
            : error.code === "LIMIT_UNEXPECTED_FILE" || error.code === "LIMIT_FILE_COUNT" ? `You can add up to ${MAX_REVIEW_IMAGES} photos.`
            : "Could not read the uploaded photos.";
        return res.status(400).json({ success: false, message });
    });
};
