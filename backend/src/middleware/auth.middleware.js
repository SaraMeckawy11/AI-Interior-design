import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const isAuthenticated = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      
      const userData = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findById(userData.id); //  removed .populate("orders")

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User not found.",
        });
      }

      req.user = user;
      next();
    } else {
      return res.status(401).json({
        success: false,
        message: "Authentication token is missing or invalid.",
      });
    }
  } catch (error) {
    console.error("JWT Verification Failed:", error.message);
    return res.status(401).json({
      success: false,
      message: "Invalid token. Authentication failed.",
    });
  }
};
