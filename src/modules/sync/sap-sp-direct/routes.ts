import { Router } from "express";
import { runSapSharePointDirectSync } from "./service";

export const sapSharePointDirectRouter = Router();

sapSharePointDirectRouter.post("/run", async (_req, res) => {
  const result = await runSapSharePointDirectSync();
  return res.status(202).json(result);
});
