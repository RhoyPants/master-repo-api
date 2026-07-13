import { Router } from "express";
import { runStagingAimsSync } from "./service";

export const stagingAimsRouter = Router();

stagingAimsRouter.post("/run", async (_req, res) => {
  const result = await runStagingAimsSync();
  return res.status(202).json(result);
});
