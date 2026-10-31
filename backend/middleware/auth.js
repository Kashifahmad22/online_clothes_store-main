import jwt from "jsonwebtoken";

const authUser = (req, res, next) => {
    const token = req.headers.token;
    if (!token) {
        return res.status(401).json({ success: false, message: "Authentication required." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded.id || decoded.role === "admin") {
            return res.status(401).json({ success: false, message: "Invalid user token." });
        }
        req.auth = { userId: decoded.id, role: "customer" };
        return next();
    } catch {
        return res.status(401).json({ success: false, message: "Session expired or invalid. Please sign in again." });
    }
};

export default authUser;
