import { Router } from "express";
import { authenticate } from "../../../../middleware/auth";
import { runUomSyncController, runUomSyncMultipleController, runUomSyncSingleController } from "./controller";

export const uomRouter = Router();

uomRouter.post("/run", authenticate, runUomSyncController);
uomRouter.post("/run/single", authenticate, runUomSyncSingleController);
uomRouter.post("/run/multiple", authenticate, runUomSyncMultipleController);
