import { Router } from "express";
import { dataItemClassRouter } from "./item-class/routes";
import { dataItemGroupRouter } from "./item-group/routes";
import { dataWarehouseRouter } from "./warehouse/routes";

export const dataRouter = Router();

dataRouter.use("/warehouse", dataWarehouseRouter);
dataRouter.use("/item-class", dataItemClassRouter);
dataRouter.use("/item-group", dataItemGroupRouter);
