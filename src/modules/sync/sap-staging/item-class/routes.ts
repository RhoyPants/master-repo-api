import { Router } from "express";
import { authenticate } from "../../../../middleware/auth";
import {
  runItemClassSyncController,
  runItemClassSyncMultipleController,
  runItemClassSyncSingleController,
} from "./controller";

export const itemClassRouter = Router();

itemClassRouter.post("/run", authenticate, runItemClassSyncController);
itemClassRouter.post("/run/single", authenticate, runItemClassSyncSingleController);
itemClassRouter.post("/run/multiple", authenticate, runItemClassSyncMultipleController);
