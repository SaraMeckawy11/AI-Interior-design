import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const isAuthenticated = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Please log in to continue.",
      });
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    const userData = jwt.verify(token, process.env.JWT_SECRET);

    // Find user in DB
    const user = await User.findById(userData.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Your account could not be found. Please log in again.",
      });
    }

    req.user = user;
    next();

  } catch (error) {
    console.error("JWT Verification Failed:", error.message);

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please log in again to continue.",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token. Please log in again.",
      });
    }

    // Fallback for unexpected errors
    return res.status(500).json({
      success: false,
      message: "An error occurred while verifying authentication.",
    });
  }
};
