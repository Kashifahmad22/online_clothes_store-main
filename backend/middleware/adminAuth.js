import jwt from "jsonwebtoken";

const adminAuth = (req, res, next) => {
    const token = req.headers.token;
    if (!token) {
        return res.status(401).json({ success: false, message: "Admin authentication required." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== "admin") {
            return res.status(403).json({ success: false, message: "Admin access required." });
        }
        req.auth = { role: "admin" };
        return next();
    } catch {
        return res.status(401).json({ success: false, message: "Admin session expired or invalid." });
    }
};

export default adminAuth;
