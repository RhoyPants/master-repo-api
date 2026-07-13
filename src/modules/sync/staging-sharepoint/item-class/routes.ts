import { Router } from "express";
import { runItemClassStagingSharePointSyncController } from "./controller";

export const stagingSharePointItemClassRouter = Router();

stagingSharePointItemClassRouter.post("/run", runItemClassStagingSharePointSyncController);
