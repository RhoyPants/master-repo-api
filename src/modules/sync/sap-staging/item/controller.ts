import { Request, Response } from "express";
import { runItemSync, runItemSyncByCodes } from "./service";

export async function runItemSyncController(_req: Request, res: Response): Promise<void> {
  try {
    const result = await runItemSync();
    res.status(200).json({
      success: true,
      message: "Item sync completed",
      data: result,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Item sync error:", errorMessage);
    res.status(500).json({
      success: false,
      message: "Item sync failed",
      error: errorMessage,
    });
  }
}

export async function runItemSyncSingleController(req: Request, res: Response): Promise<void> {
  try {
    const { code, itemCode } = req.body;
    const targetCode = code || itemCode;

    if (!targetCode || typeof targetCode !== "string" || targetCode.trim().length === 0) {
      res.status(400).json({
        success: false,
        message: "Invalid request: 'code' or 'itemCode' is required and must be a non-empty string",
      });
      return;
    }

    const result = await runItemSyncByCodes([targetCode]);
    res.status(200).json({
      success: true,
      message: "Single item sync completed",
      data: result,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Single item sync error:", errorMessage);
    res.status(500).json({
      success: false,
      message: "Single item sync failed",
      error: errorMessage,
    });
  }
}

export async function runItemSyncMultipleController(req: Request, res: Response): Promise<void> {
  try {
    const { codes, itemCodes } = req.body;
    const targetCodes = codes || itemCodes;

    if (!Array.isArray(targetCodes) || targetCodes.length === 0) {
      res.status(400).json({
        success: false,
        message: "Invalid request: 'codes' or 'itemCodes' is required and must be a non-empty array",
      });
      return;
    }

    const result = await runItemSyncByCodes(targetCodes);
    res.status(200).json({
      success: true,
      message: "Multiple items sync completed",
      data: result,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Multiple items sync error:", errorMessage);
    res.status(500).json({
      success: false,
      message: "Multiple items sync failed",
      error: errorMessage,
    });
  }
}
