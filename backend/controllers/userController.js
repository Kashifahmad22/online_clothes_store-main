import validator from "validator";
import bcrypt from "bcrypt"
import jwt from 'jsonwebtoken'
import userModel from "../models/userModel.js";
import {
    MAX_PASSWORD_BYTES,
    isAdminAuthConfigured,
    passwordExceedsBcryptLimit,
    verifyAdminCredentials
} from "../utils/adminCredentials.js";


const createToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" })
}

// Route for user login
const loginUser = async (req, res) => {
    try {

        const { email, password } = req.body || {};
        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ success: false, message: "Email and password are required." });
        }

        const user = await userModel.findOne({ email: email.trim().toLowerCase() });

        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid credentials." })
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {

            const token = createToken(user._id)
            res.json({ success: true, token })

        }
        else {
            res.status(401).json({ success: false, message: 'Invalid credentials.' })
        }

    } catch (error) {
        console.error("User login failed:", { name: error.name || "Error" });
        res.status(500).json({ success: false, message: "Unable to sign in." })
    }
}

// Route for user register
const registerUser = async (req, res) => {
    try {

        const { name, email, password } = req.body || {};
        if (typeof name !== "string" || !name.trim() ||
            typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ success: false, message: "Name, email, and password are required." });
        }

        const normalizedEmail = email.trim().toLowerCase();
        if (!validator.isEmail(normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Please enter a valid email." })
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, message: "Password must contain at least 8 characters." })
        }

        const exists = await userModel.findOne({ email: normalizedEmail });
        if (exists) {
            return res.status(409).json({ success: false, message: "User already exists." })
        }

        // hashing user password
        const salt = await bcrypt.genSalt(10)
        const hashedPassword = await bcrypt.hash(password, salt)

        const newUser = new userModel({
            name: name.trim(),
            email: normalizedEmail,
            password: hashedPassword
        })

        const user = await newUser.save()

        const token = createToken(user._id)

        res.json({ success: true, token })

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: "User already exists." })
        }
        console.error("User registration failed:", { name: error.name || "Error" });
        res.status(500).json({ success: false, message: "Unable to create the account." })
    }
}

// Route for admin login
const adminLogin = async (req, res) => {
    try {
        
        const {email,password} = req.body || {}

        if (!isAdminAuthConfigured()) {
            return res.status(503).json({ success: false, message: "Admin sign-in is not configured." })
        }
        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ success: false, message: "Email and password are required." })
        }
        if (passwordExceedsBcryptLimit(password)) {
            return res.status(400).json({ success: false, message: `Password must be ${MAX_PASSWORD_BYTES} bytes or fewer.` })
        }

        if (await verifyAdminCredentials(email, password)) {
            const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" });
            res.json({success:true,token})
        } else {
            res.status(401).json({success:false,message:"Invalid credentials."})
        }

    } catch (error) {
        console.error("Admin login failed:", { name: error.name || "Error" });
        res.status(500).json({ success: false, message: "Unable to sign in." })
    }
}


export { loginUser, registerUser, adminLogin }