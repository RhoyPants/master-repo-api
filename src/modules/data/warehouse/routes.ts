import { Router } from "express";
import {
  getWarehouseFromStagingController,
  getWarehouseFromSapController,
  getWarehouseFromSharePointController,
} from "./controller";

export const dataWarehouseRouter = Router();

dataWarehouseRouter.get("/staging", getWarehouseFromStagingController);
dataWarehouseRouter.get("/sap", getWarehouseFromSapController);
dataWarehouseRouter.get("/sharepoint", getWarehouseFromSharePointController);
