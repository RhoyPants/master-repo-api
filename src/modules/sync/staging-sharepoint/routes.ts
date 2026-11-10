import { Router } from "express";
import { stagingSharePointItemClassRouter } from "./item-class/routes";
import { stagingSharePointItemGroupRouter } from "./item-group/routes";
import { stagingSharePointUomRouter } from "./uom/routes";
import { stagingSharePointWarehouseRouter } from "./warehouse/routes";
import itemRouter from "./item/routes";
import { configuredSharePointSync } from "../../mappings/routes";

export const stagingSharePointRouter = Router();
stagingSharePointRouter.use(configuredSharePointSync);

stagingSharePointRouter.use("/warehouse", stagingSharePointWarehouseRouter);
stagingSharePointRouter.use("/item-class", stagingSharePointItemClassRouter);
stagingSharePointRouter.use("/item-group", stagingSharePointItemGroupRouter);
stagingSharePointRouter.use("/uom", stagingSharePointUomRouter);
stagingSharePointRouter.use("/item", itemRouter);
