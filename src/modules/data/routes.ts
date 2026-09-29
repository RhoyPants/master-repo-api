import { Router } from "express";
import { dataItemClassRouter } from "./item-class/routes";
import { dataItemGroupRouter } from "./item-group/routes";
import { dataUomRouter } from "./uom/routes";
import { dataWarehouseRouter } from "./warehouse/routes";
import itemRouter from "./item/routes";

export const dataRouter = Router();

dataRouter.use("/warehouse", dataWarehouseRouter);
dataRouter.use("/item-class", dataItemClassRouter);
dataRouter.use("/item-group", dataItemGroupRouter);
dataRouter.use("/uom", dataUomRouter);
dataRouter.use("/item", itemRouter);
