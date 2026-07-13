import { Router } from "express";
import { authenticate } from "../../../../middleware/auth";
import {
  runItemGroupSyncController,
  runItemGroupSyncMultipleController,
  runItemGroupSyncSingleController,
} from "./controller";

export const itemGroupRouter = Router();

itemGroupRouter.post("/run", authenticate, runItemGroupSyncController);
itemGroupRouter.post("/run/single", authenticate, runItemGroupSyncSingleController);
itemGroupRouter.post("/run/multiple", authenticate, runItemGroupSyncMultipleController);
