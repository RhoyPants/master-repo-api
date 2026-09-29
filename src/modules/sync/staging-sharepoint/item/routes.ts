import { Router } from "express";
import { authenticate } from "../../../../middleware/auth";
import {
	runItemStagingSharePointSyncController,
	runItemStagingSharePointSyncMultipleController,
	runItemStagingSharePointSyncSingleController,
} from "./controller";

const router = Router();

router.post("/run", authenticate, runItemStagingSharePointSyncController);
router.post("/run/single", authenticate, runItemStagingSharePointSyncSingleController);
router.post("/run/multiple", authenticate, runItemStagingSharePointSyncMultipleController);

export default router;
