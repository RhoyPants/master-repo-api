import { Request, Response } from "express";
import { runItemClassStagingSharePointSync } from "./service";

export const runItemClassStagingSharePointSyncController = async (_req: Request, res: Response) => {
  try {
    const result = await runItemClassStagingSharePointSync();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Staging -> SharePoint item class sync failed",
      error: (error as Error).message,
    });
  }
};
