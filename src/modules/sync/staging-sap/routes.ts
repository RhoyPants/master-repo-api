import { Router } from "express";
import { runStagingSapSync } from "./service";

export const stagingSapRouter = Router();

stagingSapRouter.post("/run", async (_req, res) => {
  const result = await runStagingSapSync();
  return res.status(202).json(result);
});
