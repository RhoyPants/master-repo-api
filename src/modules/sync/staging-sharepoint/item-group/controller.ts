import { Request, Response } from "express";
import { runItemGroupStagingSharePointSync as runItemGroupStagingSharePointSyncUntracked } from "./service";
import { auditLegacySync } from "../../../../lib/audit-legacy-sync";
const runItemGroupStagingSharePointSync = (...args: Parameters<typeof runItemGroupStagingSharePointSyncUntracked>) => auditLegacySync('item-group', () => runItemGroupStagingSharePointSyncUntracked(...args), args.length > 0);

export const runItemGroupStagingSharePointSyncController = async (_req: Request, res: Response) => {
  try {
    const result = await runItemGroupStagingSharePointSync();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Staging -> SharePoint item group sync failed",
      error: (error as Error).message,
    });
  }
};
