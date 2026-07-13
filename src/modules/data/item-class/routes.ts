import { Router } from "express";
import {
  getItemClassFromSapController,
  getItemClassFromSharePointController,
  getItemClassFromStagingController,
} from "./controller";

export const dataItemClassRouter = Router();

dataItemClassRouter.get("/staging", getItemClassFromStagingController);
dataItemClassRouter.get("/sap", getItemClassFromSapController);
dataItemClassRouter.get("/sharepoint", getItemClassFromSharePointController);
