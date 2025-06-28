import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

export const sendToken = async (user, res) => {
  try {
    const accessToken = jwt.sign(
      {
        id: user._id, // Use `_id` for Mongoose
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "15d" } // Optional: Add expiration
    );

    res.status(200).json({
      success: true,
      accessToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error(" Token generation error:", error);
    res.status(500).json({ success: false, message: "Token creation failed" });
  }
};
