import { Request, Response } from "express";
import { runItemClassSync, runItemClassSyncByCodes } from "./service";

export const runItemClassSyncController = async (_req: Request, res: Response) => {
  try {
    const result = await runItemClassSync();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Item class sync failed", error: (err as Error).message });
  }
};

export const runItemClassSyncSingleController = async (req: Request, res: Response) => {
  try {
    const { itmsGrpCod, code } = req.body as { itmsGrpCod?: string; code?: string };
    const selectedCode = code ?? itmsGrpCod;

    if (!selectedCode || !selectedCode.trim()) {
      return res.status(400).json({ message: "code is required" });
    }

    const result = await runItemClassSyncByCodes([selectedCode]);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Single item class sync failed", error: (err as Error).message });
  }
};

export const runItemClassSyncMultipleController = async (req: Request, res: Response) => {
  try {
    const { codes } = req.body as { codes?: string[] };

    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ message: "codes must be a non-empty array" });
    }

    const result = await runItemClassSyncByCodes(codes);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Multiple item class sync failed", error: (err as Error).message });
  }
};
