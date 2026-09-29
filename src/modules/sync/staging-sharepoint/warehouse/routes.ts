import { Router } from "express";
import {
  runWarehouseStagingSharePointSyncController,
  runWarehouseStagingSharePointSyncSingleController,
  runWarehouseStagingSharePointSyncMultipleController,
} from "./controller";

export const stagingSharePointWarehouseRouter = Router();

stagingSharePointWarehouseRouter.post("/run", runWarehouseStagingSharePointSyncController);
stagingSharePointWarehouseRouter.post("/run/single", runWarehouseStagingSharePointSyncSingleController);
stagingSharePointWarehouseRouter.post("/run/multiple", runWarehouseStagingSharePointSyncMultipleController);