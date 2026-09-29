import { Request, Response } from "express";
import { runUomSync, runUomSyncByCodes } from "./service";

export const runUomSyncController = async (_req: Request, res: Response) => {
  try {
    const result = await runUomSync();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "UOM sync failed",
      error: (err as Error).message,
    });
  }
};

export const runUomSyncSingleController = async (req: Request, res: Response) => {
  try {
    const { uomCode, code } = req.body as { uomCode?: string; code?: string };
    const selectedCode = code ?? uomCode;

    if (!selectedCode || !selectedCode.trim()) {
      return res.status(400).json({ message: "uomCode or code is required" });
    }

    const result = await runUomSyncByCodes([selectedCode]);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "Single UOM sync failed",
      error: (err as Error).message,
    });
  }
};

export const runUomSyncMultipleController = async (req: Request, res: Response) => {
  try {
    const { uomCodes, codes } = req.body as { uomCodes?: string[]; codes?: string[] };
    const selectedCodes = codes ?? uomCodes;

    if (!Array.isArray(selectedCodes) || selectedCodes.length === 0) {
      return res.status(400).json({ message: "uomCodes or codes must be a non-empty array" });
    }

    const result = await runUomSyncByCodes(selectedCodes);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "Multiple UOM sync failed",
      error: (err as Error).message,
    });
  }
};
