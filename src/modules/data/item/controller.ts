import { Request, Response } from "express";
import { getItemsFromStaging, getItemsFromSAP, getItemsFromSharePoint } from "./service";

export async function getItemsStagingController(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit, search, itemCode, itemDescription, category, itemClassCode, itemGroupName, isActive } = req.query;

    const result = await getItemsFromStaging({
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 20,
      search: search as string | undefined,
      itemCode: itemCode as string | undefined,
      itemDescription: itemDescription as string | undefined,
      category: category as string | undefined,
      itemClassCode: itemClassCode as string | undefined,
      itemGroupName: itemGroupName as string | undefined,
      isActive: isActive ? isActive === "true" : undefined,
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMessage });
  }
}

export async function getItemsSAPController(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit, search, itemCode, itemDescription, category, itemClassCode, itemGroupName } = req.query;

    const result = await getItemsFromSAP({
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 20,
      search: search as string | undefined,
      itemCode: itemCode as string | undefined,
      itemDescription: itemDescription as string | undefined,
      category: category as string | undefined,
      itemClassCode: itemClassCode as string | undefined,
      itemGroupName: itemGroupName as string | undefined,
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMessage });
  }
}

export async function getItemsSharePointController(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit, search, itemCode, itemDescription, category, itemClassCode, itemGroupName } = req.query;

    const result = await getItemsFromSharePoint({
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 20,
      search: search as string | undefined,
      itemCode: itemCode as string | undefined,
      itemDescription: itemDescription as string | undefined,
      category: category as string | undefined,
      itemClassCode: itemClassCode as string | undefined,
      itemGroupName: itemGroupName as string | undefined,
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMessage });
  }
}
