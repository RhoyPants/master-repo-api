import { Router } from "express";
import { runItemMasterStagingSync } from "./service";
import { itemGroupRouter } from "./item-group/routes";

export const itemMasterStagingRouter = Router();

itemMasterStagingRouter.post("/run", async (_req, res) => {
  const result = await runItemMasterStagingSync();
  return res.status(202).json(result);
});

itemMasterStagingRouter.use("/item-group", itemGroupRouter);
