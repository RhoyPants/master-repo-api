import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { authenticate } from "./middleware/auth";
import { syncRouter } from "./modules/sync";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { mappingsRouter } from "./modules/mappings/routes";
import { dataReadCacheLifecycle } from "./lib/data-read-cache";
import { auditRequestContext } from "./lib/audit-context";
import { auditRouter } from "./modules/audit/routes";

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
app.use(auditRequestContext);
app.use(dataReadCacheLifecycle);

app.get("/", (_req, res) => {
  res.json({
    message: `Express + Prisma + SQL Server backend is running on port ${env.port}`,
  });
});

app.use("/api", healthRouter);
app.use("/api/audit", auditRouter);
app.use("/api/mappings", mappingsRouter);
app.use("/sync", syncRouter);
