import { Router } from "express";
import {
  getUomFromSapController,
  getUomFromSharePointController,
  getUomFromStagingController,
} from "./controller";

export const dataUomRouter = Router();

dataUomRouter.get("/staging", getUomFromStagingController);
dataUomRouter.get("/sap", getUomFromSapController);
dataUomRouter.get("/sharepoint", getUomFromSharePointController);
