import { Router } from "express";
import { authenticate } from "../../../../middleware/auth";
import {
  runUomStagingSharePointSyncController,
  runUomStagingSharePointSyncMultipleController,
  runUomStagingSharePointSyncSingleController,
} from "./controller";

export const stagingSharePointUomRouter = Router();

stagingSharePointUomRouter.post("/run", authenticate, runUomStagingSharePointSyncController);
stagingSharePointUomRouter.post("/run/single", authenticate, runUomStagingSharePointSyncSingleController);
stagingSharePointUomRouter.post("/run/multiple", authenticate, runUomStagingSharePointSyncMultipleController);
