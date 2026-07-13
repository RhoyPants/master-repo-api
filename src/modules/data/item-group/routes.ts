import { Router } from "express";
import {
  getItemGroupFromItemMasterController,
  getItemGroupFromSharePointController,
  getItemGroupFromStagingController,
} from "./controller";

export const dataItemGroupRouter = Router();

dataItemGroupRouter.get("/staging", getItemGroupFromStagingController);
dataItemGroupRouter.get("/itemmaster", getItemGroupFromItemMasterController);
dataItemGroupRouter.get("/sharepoint", getItemGroupFromSharePointController);
