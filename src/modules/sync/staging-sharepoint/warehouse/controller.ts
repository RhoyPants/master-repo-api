import { Request, Response } from "express";
import { runWarehouseStagingSharePointSync, runWarehouseStagingSharePointSyncByCodes } from "./service";

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

export const runWarehouseStagingSharePointSyncSingleController = async (
  req: Request,
  res: Response,
) => {
  try {
    const { code, whCode } = req.body;
    const targetCode = code || whCode;

    if (!targetCode || typeof targetCode !== "string") {
      return res.status(400).json({
        message: "Invalid request",
        error: "code or whCode is required and must be a string",
      });
    }

    const result = await runWarehouseStagingSharePointSyncByCodes([targetCode]);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Staging -> SharePoint warehouse single sync failed",
      error: (error as Error).message,
    });
  }
};

export const runWarehouseStagingSharePointSyncMultipleController = async (
  req: Request,
  res: Response,
) => {
  try {
    const { codes, whCodes } = req.body;
    const targetCodes = codes || whCodes;

    if (!Array.isArray(targetCodes) || targetCodes.length === 0) {
      return res.status(400).json({
        message: "Invalid request",
        error: "codes or whCodes is required and must be a non-empty array",
      });
    }

    const result = await runWarehouseStagingSharePointSyncByCodes(targetCodes);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Staging -> SharePoint warehouse multiple sync failed",
      error: (error as Error).message,
    });
  }
};