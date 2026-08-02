import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import designRoutes from "./routes/designRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/admin.routes.js";
import floorplanRoutes from "./routes/floorplanRoutes.js";
import walkthroughRoutes from "./routes/walkthroughRoutes.js";
import job from "./lib/cron.js";


import { connectDB } from "./lib/db.js";
import { isAuthenticated } from "./middleware/auth.middleware.js";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

job.start();
app.use(express.json({ limit: '100mb' }));
app.use(cors());

app.use("/api/auth", authRoutes);
app.use("/api/designs", designRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/floorplans", floorplanRoutes);
app.use("/api/walkthrough", walkthroughRoutes);

app.get("/me", isAuthenticated, async (req, res, next) => {
  try {
    const user = req.user;
    res.status(201).json({
      success: true,
      user,
    });
  } catch (error) {
    console.log(error);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  connectDB();
});
