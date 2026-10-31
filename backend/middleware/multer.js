import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import multer from "multer";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const storage = multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, callback) => {
        callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 12 },
    fileFilter: (req, file, callback) => {
        if (!allowedTypes.has(file.mimetype)) {
            return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
        }
        return callback(null, true);
    }
});

export default upload;
