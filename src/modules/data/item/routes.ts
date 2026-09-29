import { Router } from "express";
import { getItemsStagingController, getItemsSAPController, getItemsSharePointController } from "./controller";

const router = Router();

router.get("/staging", getItemsStagingController);
router.get("/sap", getItemsSAPController);
router.get("/sharepoint", getItemsSharePointController);

export default router;
