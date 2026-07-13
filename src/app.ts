import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { authenticate } from "./middleware/auth";
import { syncRouter } from "./modules/sync";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";

export const app = express();


app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());

app.use("/auth", authRouter);
app.use(authenticate);

app.get("/", (_req, res) => {
  res.json({
    message: `Express + Prisma + SQL Server backend is running on port ${env.port}`,
  });
});

app.use("/api", healthRouter);
app.use("/sync", syncRouter);
