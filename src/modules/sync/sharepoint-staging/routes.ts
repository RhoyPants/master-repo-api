import { Router } from "express";
import { runSharePointStagingSync } from "./service";

export const sharePointStagingRouter = Router();

sharePointStagingRouter.post("/run", async (_req, res) => {
  const result = await runSharePointStagingSync();
  return res.status(202).json(result);
});
