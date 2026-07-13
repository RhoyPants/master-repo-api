import { Request, Response } from "express";
import { runWarehouseStagingSharePointSync } from "./service";

export const runWarehouseStagingSharePointSyncController = async (_req: Request, res: Response) => {
  try {
    const result = await runWarehouseStagingSharePointSync();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Staging -> SharePoint warehouse sync failed",
      error: (error as Error).message,
    });
  }
};