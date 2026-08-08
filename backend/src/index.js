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
import { rendererReadiness, reportRendererReadiness } from "./lib/walkthroughRenderer.js";


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

/**
 * Liveness plus one thing that is easy to get wrong: whether this deploy can
 * actually run the walkthrough exporter.
 *
 * The exporter is Python, and a service running Render's native Node runtime
 * starts and serves every other route perfectly while having no numpy, Shapely,
 * trimesh or Open3D at all. The first person to reach the Explore step is a bad
 * way to find that out; this route answers it before anyone taps anything.
 * It stays 200 either way so the platform's health check does not restart an
 * API that is otherwise fine.
 */
app.get("/healthz", async (req, res) => {
  const renderer = await rendererReadiness();
  res.json({ ok: true, renderer });
});

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
  // Fire and forget: the answer is cached, so /healthz and the first
  // walkthrough request both reuse it. Failing here must not stop the API.
  reportRendererReadiness().catch(() => {});
});
