import { Router } from "express";
import { stagingSharePointItemClassRouter } from "./item-class/routes";
import { stagingSharePointItemGroupRouter } from "./item-group/routes";
import { stagingSharePointWarehouseRouter } from "./warehouse/routes";

export const stagingSharePointRouter = Router();

stagingSharePointRouter.use("/warehouse", stagingSharePointWarehouseRouter);
stagingSharePointRouter.use("/item-class", stagingSharePointItemClassRouter);
stagingSharePointRouter.use("/item-group", stagingSharePointItemGroupRouter);
