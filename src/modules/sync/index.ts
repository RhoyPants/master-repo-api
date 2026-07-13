import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { dataRouter } from "../data/routes";
import { itemMasterStagingRouter } from "./itemMaster-staging/routes";
import { sapStagingRouter } from "./sap-staging/routes";
import { sapSharePointDirectRouter } from "./sap-sp-direct/routes";
import { sharePointStagingRouter } from "./sharepoint-staging/routes";
import { stagingAimsRouter } from "./staging-aims/routes";
import { stagingSapRouter } from "./staging-sap/routes";
import { stagingSharePointRouter } from "./staging-sharepoint/routes";

export const syncRouter = Router();

// Protect all sync routes — JWT required
syncRouter.use(authenticate);

syncRouter.use("/sap-staging", sapStagingRouter);
syncRouter.use("/data", dataRouter);
syncRouter.use("/staging-sharepoint", stagingSharePointRouter);
syncRouter.use("/sharepoint-staging", sharePointStagingRouter);
syncRouter.use("/staging-aims", stagingAimsRouter);
syncRouter.use("/staging-sap", stagingSapRouter);
syncRouter.use("/sap-sp-direct", sapSharePointDirectRouter);
syncRouter.use("/itemmaster-staging", itemMasterStagingRouter);
