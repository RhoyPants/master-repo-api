import { Request, Response } from "express";
import {
  getWarehousesFromStaging,
  getWarehousesFromSap,
  getWarehousesFromSharePoint,
} from "./service";

export const getWarehouseFromStagingController = async (req: Request, res: Response) => {
  try {
    const result = await getWarehousesFromStaging({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      whCode: typeof req.query.whCode === "string" ? req.query.whCode : undefined,
      whName: typeof req.query.whName === "string" ? req.query.whName : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getWarehouseFromSapController = async (req: Request, res: Response) => {
  try {
    const result = await getWarehousesFromSap({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      whCode: typeof req.query.whCode === "string" ? req.query.whCode : undefined,
      whName: typeof req.query.whName === "string" ? req.query.whName : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getWarehouseFromSharePointController = async (req: Request, res: Response) => {
  try {
    const result = await getWarehousesFromSharePoint({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      whCode: typeof req.query.whCode === "string" ? req.query.whCode : undefined,
      whName: typeof req.query.whName === "string" ? req.query.whName : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
