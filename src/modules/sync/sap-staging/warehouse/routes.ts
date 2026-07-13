import { Router } from "express";
import { authenticate } from "../../../../middleware/auth";
import {
	runWarehouseSyncMultipleController,
	runWarehouseSyncController,
	runWarehouseSyncSingleController,
} from "./controller";

export const warehouseRouter = Router();

warehouseRouter.post("/run/single", authenticate, runWarehouseSyncSingleController);
warehouseRouter.post("/run/multiple", authenticate, runWarehouseSyncMultipleController);
warehouseRouter.post("/run", authenticate, runWarehouseSyncController);
