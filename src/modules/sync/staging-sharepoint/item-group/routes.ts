import { Router } from "express";
import { runItemGroupStagingSharePointSyncController } from "./controller";

export const stagingSharePointItemGroupRouter = Router();

stagingSharePointItemGroupRouter.post("/run", runItemGroupStagingSharePointSyncController);
