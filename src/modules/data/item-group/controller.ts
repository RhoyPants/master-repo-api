import { Request, Response } from "express";
import {
  getItemGroupFromItemMaster,
  getItemGroupFromSharePoint,
  getItemGroupFromStaging,
} from "./service";

export const getItemGroupFromStagingController = async (req: Request, res: Response) => {
  try {
    const result = await getItemGroupFromStaging({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      itemGroupId: typeof req.query.itemGroupId === "string" ? req.query.itemGroupId : undefined,
      initials: typeof req.query.initials === "string" ? req.query.initials : undefined,
      name: typeof req.query.name === "string" ? req.query.name : undefined,
      itemClassCode: typeof req.query.itemClassCode === "string" ? req.query.itemClassCode : undefined,
      itemClass: typeof req.query.itemClass === "string" ? req.query.itemClass : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getItemGroupFromItemMasterController = async (req: Request, res: Response) => {
  try {
    const result = await getItemGroupFromItemMaster({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      itemGroupId: typeof req.query.itemGroupId === "string" ? req.query.itemGroupId : undefined,
      initials: typeof req.query.initials === "string" ? req.query.initials : undefined,
      name: typeof req.query.name === "string" ? req.query.name : undefined,
      itemClassCode: typeof req.query.itemClassCode === "string" ? req.query.itemClassCode : undefined,
      itemClass: typeof req.query.itemClass === "string" ? req.query.itemClass : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getItemGroupFromSharePointController = async (req: Request, res: Response) => {
  try {
    const result = await getItemGroupFromSharePoint({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      itemGroupId: typeof req.query.itemGroupId === "string" ? req.query.itemGroupId : undefined,
      initials: typeof req.query.initials === "string" ? req.query.initials : undefined,
      name: typeof req.query.name === "string" ? req.query.name : undefined,
      itemClassCode: typeof req.query.itemClassCode === "string" ? req.query.itemClassCode : undefined,
      itemClass: typeof req.query.itemClass === "string" ? req.query.itemClass : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
