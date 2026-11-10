import { Request, Response } from "express";
import { runItemStagingSharePointSync as runItemStagingSharePointSyncUntracked, runItemStagingSharePointSyncByCodes as runItemStagingSharePointSyncByCodesUntracked } from "./service";
import { auditLegacySync } from "../../../../lib/audit-legacy-sync";
const runItemStagingSharePointSync = (...args: Parameters<typeof runItemStagingSharePointSyncUntracked>) => auditLegacySync('item', () => runItemStagingSharePointSyncUntracked(...args), args.length > 0);
const runItemStagingSharePointSyncByCodes = (...args: Parameters<typeof runItemStagingSharePointSyncByCodesUntracked>) => auditLegacySync('item', () => runItemStagingSharePointSyncByCodesUntracked(...args), args.length > 0);

export async function runItemStagingSharePointSyncController(_req: Request, res: Response): Promise<void> {
  try {
    const result = await runItemStagingSharePointSync();
    res.status(200).json({
      success: true,
      message: "Item staging to SharePoint sync completed",
      data: result,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Item staging to SharePoint sync error:", errorMessage);
    res.status(500).json({
      success: false,
      message: "Item staging to SharePoint sync failed",
      error: errorMessage,
    });
  }
}

export async function runItemStagingSharePointSyncSingleController(req: Request, res: Response): Promise<void> {
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

    const result = await runItemStagingSharePointSyncByCodes([targetCode]);
    res.status(200).json({
      success: true,
      message: "Single item staging to SharePoint sync completed",
      data: result,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Single item staging to SharePoint sync error:", errorMessage);
    res.status(500).json({
      success: false,
      message: "Single item staging to SharePoint sync failed",
      error: errorMessage,
    });
  }
}

export async function runItemStagingSharePointSyncMultipleController(req: Request, res: Response): Promise<void> {
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

    const result = await runItemStagingSharePointSyncByCodes(targetCodes);
    res.status(200).json({
      success: true,
      message: "Multiple items staging to SharePoint sync completed",
      data: result,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Multiple items staging to SharePoint sync error:", errorMessage);
    res.status(500).json({
      success: false,
      message: "Multiple items staging to SharePoint sync failed",
      error: errorMessage,
    });
  }
}
