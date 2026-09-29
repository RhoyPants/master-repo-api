import { Request, Response } from "express";
import { getUomFromSap, getUomFromSharePoint, getUomFromStaging } from "./service";

export const getUomFromStagingController = async (req: Request, res: Response) => {
  try {
    const result = await getUomFromStaging({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      uomCode: typeof req.query.uomCode === "string" ? req.query.uomCode : undefined,
      uomName: typeof req.query.uomName === "string" ? req.query.uomName : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getUomFromSapController = async (req: Request, res: Response) => {
  try {
    const result = await getUomFromSap({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      uomCode: typeof req.query.uomCode === "string" ? req.query.uomCode : undefined,
      uomName: typeof req.query.uomName === "string" ? req.query.uomName : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getUomFromSharePointController = async (req: Request, res: Response) => {
  try {
    const result = await getUomFromSharePoint({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      uomCode: typeof req.query.uomCode === "string" ? req.query.uomCode : undefined,
      uomName: typeof req.query.uomName === "string" ? req.query.uomName : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
