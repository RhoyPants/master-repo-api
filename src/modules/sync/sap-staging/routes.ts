import { Router } from "express";
import { runSapStagingSync } from "./service";
import { itemClassRouter } from "./item-class/routes";
import { uomRouter } from "./uom/routes";
import { warehouseRouter } from "./warehouse/routes";
import itemRouter from "./item/routes";

export const sapStagingRouter = Router();

sapStagingRouter.post("/run", async (_req, res) => {
  const result = await runSapStagingSync();
  return res.status(202).json(result);
});

sapStagingRouter.use("/warehouse", warehouseRouter);
sapStagingRouter.use("/item-class", itemClassRouter);
sapStagingRouter.use("/uom", uomRouter);
sapStagingRouter.use("/item", itemRouter);
