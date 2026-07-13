import { Request, Response } from "express";
import {
  runWarehouseSyncByCodes,
  runWarehouseSync,
} from "./service";

export const runWarehouseSyncController = async (_req: Request, res: Response) => {
  try {
    const result = await runWarehouseSync();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "Warehouse sync failed",
      error: (err as Error).message,
    });
  }
};

export const runWarehouseSyncSingleController = async (req: Request, res: Response) => {
  try {
    const { whCode } = req.body as { whCode?: string };

    if (!whCode || !whCode.trim()) {
      return res.status(400).json({
        message: "whCode is required",
      });
    }

    const result = await runWarehouseSyncByCodes([whCode]);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "Single warehouse sync failed",
      error: (err as Error).message,
    });
  }
};

export const runWarehouseSyncMultipleController = async (req: Request, res: Response) => {
  try {
    const { whCodes } = req.body as { whCodes?: string[] };

    if (!Array.isArray(whCodes) || whCodes.length === 0) {
      return res.status(400).json({
        message: "whCodes must be a non-empty array",
      });
    }

    const result = await runWarehouseSyncByCodes(whCodes);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "Multiple warehouse sync failed",
      error: (err as Error).message,
    });
  }
};

