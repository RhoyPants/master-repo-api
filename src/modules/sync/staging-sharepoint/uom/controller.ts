import { Request, Response } from "express";
import { runUomStagingSharePointSync as runUomStagingSharePointSyncUntracked, runUomStagingSharePointSyncByCodes as runUomStagingSharePointSyncByCodesUntracked } from "./service";
import { auditLegacySync } from "../../../../lib/audit-legacy-sync";
const runUomStagingSharePointSync = (...args: Parameters<typeof runUomStagingSharePointSyncUntracked>) => auditLegacySync('uom', () => runUomStagingSharePointSyncUntracked(...args), args.length > 0);
const runUomStagingSharePointSyncByCodes = (...args: Parameters<typeof runUomStagingSharePointSyncByCodesUntracked>) => auditLegacySync('uom', () => runUomStagingSharePointSyncByCodesUntracked(...args), args.length > 0);

export const runUomStagingSharePointSyncController = async (_req: Request, res: Response) => {
  try {
    const result = await runUomStagingSharePointSync();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Staging -> SharePoint UOM sync failed",
      error: (error as Error).message,
    });
  }
};

export const runUomStagingSharePointSyncSingleController = async (req: Request, res: Response) => {
  try {
    const { uomCode, code } = req.body as { uomCode?: string; code?: string };
    const selectedCode = code ?? uomCode;

    if (!selectedCode || !selectedCode.trim()) {
      return res.status(400).json({ message: "uomCode or code is required" });
    }

    const result = await runUomStagingSharePointSyncByCodes([selectedCode]);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Single staging -> SharePoint UOM sync failed",
      error: (error as Error).message,
    });
  }
};

export const runUomStagingSharePointSyncMultipleController = async (req: Request, res: Response) => {
  try {
    const { uomCodes, codes } = req.body as { uomCodes?: string[]; codes?: string[] };
    const selectedCodes = codes ?? uomCodes;

    if (!Array.isArray(selectedCodes) || selectedCodes.length === 0) {
      return res.status(400).json({ message: "uomCodes or codes must be a non-empty array" });
    }

    const result = await runUomStagingSharePointSyncByCodes(selectedCodes);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Multiple staging -> SharePoint UOM sync failed",
      error: (error as Error).message,
    });
  }
};
