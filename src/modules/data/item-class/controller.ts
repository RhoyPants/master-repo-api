import { Request, Response } from "express";
import { getItemClassFromSap, getItemClassFromSharePoint, getItemClassFromStaging } from "./service";

export const getItemClassFromStagingController = async (req: Request, res: Response) => {
  try {
    const result = await getItemClassFromStaging({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      itmsGrpCod: typeof req.query.itmsGrpCod === "string" ? req.query.itmsGrpCod : undefined,
      initials: typeof req.query.initials === "string" ? req.query.initials : undefined,
      itmsGrpNam: typeof req.query.itmsGrpNam === "string" ? req.query.itmsGrpNam : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getItemClassFromSapController = async (req: Request, res: Response) => {
  try {
    const result = await getItemClassFromSap({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      itmsGrpCod: typeof req.query.itmsGrpCod === "string" ? req.query.itmsGrpCod : undefined,
      initials: typeof req.query.initials === "string" ? req.query.initials : undefined,
      itmsGrpNam: typeof req.query.itmsGrpNam === "string" ? req.query.itmsGrpNam : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getItemClassFromSharePointController = async (req: Request, res: Response) => {
  try {
    const result = await getItemClassFromSharePoint({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      itmsGrpCod: typeof req.query.itmsGrpCod === "string" ? req.query.itmsGrpCod : undefined,
      initials: typeof req.query.initials === "string" ? req.query.initials : undefined,
      itmsGrpNam: typeof req.query.itmsGrpNam === "string" ? req.query.itmsGrpNam : undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
