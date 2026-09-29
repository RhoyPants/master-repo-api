import { Router } from "express";
import { authenticate } from "../../../../middleware/auth";
import { runItemSyncController, runItemSyncSingleController, runItemSyncMultipleController } from "./controller";

const router = Router();

router.post("/run", authenticate, runItemSyncController);
router.post("/run/single", authenticate, runItemSyncSingleController);
router.post("/run/multiple", authenticate, runItemSyncMultipleController);

export default router;
