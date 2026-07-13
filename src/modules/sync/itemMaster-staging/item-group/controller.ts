import { Request, Response } from "express";
import { runItemGroupSync, runItemGroupSyncByCodes } from "./service";

export const runItemGroupSyncController = async (_req: Request, res: Response) => {
  try {
    const result = await runItemGroupSync();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "Item group sync failed",
      error: (err as Error).message,
    });
  }
};

export const runItemGroupSyncSingleController = async (req: Request, res: Response) => {
  try {
    const { itemGroupId, code } = req.body as { itemGroupId?: string; code?: string };
    const selectedCode = code ?? itemGroupId;

    if (!selectedCode || !selectedCode.trim()) {
      return res.status(400).json({ message: "code is required" });
    }

    const result = await runItemGroupSyncByCodes([selectedCode]);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "Single item group sync failed",
      error: (err as Error).message,
    });
  }
};

export const runItemGroupSyncMultipleController = async (req: Request, res: Response) => {
  try {
    const { codes } = req.body as { codes?: string[] };

    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ message: "codes must be a non-empty array" });
    }

    const result = await runItemGroupSyncByCodes(codes);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "Multiple item group sync failed",
      error: (err as Error).message,
    });
  }
};
