import { Router } from "express";
import { runWarehouseStagingSharePointSyncController } from "./controller";

export const stagingSharePointWarehouseRouter = Router();

stagingSharePointWarehouseRouter.post("/run", runWarehouseStagingSharePointSyncController);