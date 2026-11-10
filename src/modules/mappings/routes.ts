import { NextFunction, Request, Response, Router } from "express";
import { MappingError, parseConfig } from "./domain";
import { defaultMappings } from "./defaults";
import { collection, destinationColumns, sourceColumns, sourceTables, lookupColumns, lookupTables } from "./metadata";
import { executeMapping, prepare, previewMapping } from "./service";
import { mappingHistory, mappingVersion, savedMapping, savedMappings, saveMapping } from "./store";
import { mappingRoute as route, positiveVersion, queryText, selectedMappingCodes } from "./routing";
import { sapMappingsRouter } from "./sap/routes";
import { itemMasterMappingsRouter } from "./itemmaster/routes";

export const mappingsRouter = Router();
// Authentication is applied by app.ts; this internal tool does not use role-based access.
mappingsRouter.use("/sap-staging", sapMappingsRouter);
mappingsRouter.use("/itemmaster-staging", itemMasterMappingsRouter);
mappingsRouter.get("/tables", route(async (_req, res) => res.json(await sourceTables())));
mappingsRouter.get("/columns", route(async (req, res) => res.json(await sourceColumns(queryText(req, "table")))));
mappingsRouter.get("/lookup/tables", route(async (req, res) => res.json(await lookupTables(req.query.database))));
mappingsRouter.get("/lookup/columns", route(async (req, res) => res.json(await lookupColumns(queryText(req, "table"), req.query.database))));
mappingsRouter.get("/sharepoint/lists", route(async (req, res) => {
  const siteId = queryText(req, "siteId");
  res.json(await collection<{ id: string; displayName: string }>(`sites/${encodeURIComponent(siteId)}/lists?$select=id,displayName`));
}));
mappingsRouter.get("/sharepoint/columns", route(async (req, res) => res.json(await destinationColumns(queryText(req, "siteId"), queryText(req, "listId")))));
mappingsRouter.get("/sharepoint", route(async (_req, res) => res.json({ saved: await savedMappings(), defaults: defaultMappings() })));
mappingsRouter.get("/sharepoint/:module/history", route(async (req, res) => {
  const before = req.query.beforeVersion === undefined ? undefined : positiveVersion(req.query.beforeVersion);
  res.json(await mappingHistory(String(req.params.module), before));
}));
mappingsRouter.get("/sharepoint/:module/history/:version", route(async (req, res) => {
  res.json(await mappingVersion(String(req.params.module), positiveVersion(req.params.version)));
}));
mappingsRouter.post("/sharepoint/validate-json", route(async (req, res) => res.json(parseConfig(req.body.config))));
mappingsRouter.post("/sharepoint/preview", route(async (req, res) => res.json(await previewMapping(req.body.config))));
mappingsRouter.put("/sharepoint/:module", route(async (req, res) => {
  const config = parseConfig(req.body.config);
  if (config.module !== req.params.module) throw new MappingError("The module in the URL and mapping must match.");
  const { enabled, version } = req.body;
  if (typeof enabled !== "boolean" || !Number.isSafeInteger(version) || version < 0) throw new MappingError("A boolean enabled flag and integer version are required.");
  await prepare(config);
  // Block activation when sampled data would fail transformation or required-field validation.
  if (enabled) {
    const preview = await previewMapping(config);
    const bad = preview.rows.find(row => "error" in row);
    if (bad && "error" in bad) throw new MappingError(`Cannot enable mapping: ${bad.error}`);
  }
  res.json(await saveMapping(config, enabled, version, req.user!.email));
}));
mappingsRouter.post("/sharepoint/:module/run", route(async (req, res) => {
  if (req.body.confirm !== true) throw new MappingError("Confirm the SharePoint sync before running it.");
  res.json(await executeMapping(String(req.params.module)));
}));
mappingsRouter.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof MappingError) { res.status(error.status).json({ message: error.message }); return; }
  console.error("Mapping request failed:", error instanceof Error ? error.name : "Unknown error");
  const meta = (error as { meta?: { code?: string } })?.meta;
  if (meta?.code === "208") { res.status(503).json({ message: "Mapping storage or version history is not installed. Apply the integration_mappings and mapping_version_history database migrations." }); return; }
  res.status(500).json({ message: "Mapping request failed. Check database connectivity and API logs." });
});

// Keep existing sync URLs and response shapes while routing enabled configurations through the engine.
export async function configuredSharePointSync(req: Request, res: Response, next: NextFunction) {
  const match = /^\/(warehouse|item-class|item-group|item|uom)\/run(?:\/(single|multiple))?\/?$/.exec(req.path);
  if (req.method !== "POST" || !match) { next(); return; }
  try {
    let saved;
    try { saved = await savedMapping(match[1]!); }
    catch (error) {
      // Existing installs can still run built-in services before the new migration is applied.
      if ((error as { meta?: { code?: string } }).meta?.code === "208") { next(); return; }
      throw error;
    }
    if (!saved?.enabled) { next(); return; }
    const codes = selectedMappingCodes(req.body ?? {}, match[2]);
    const result = await executeMapping(match[1]!, codes);
    res.json(match[1] === "item" ? { success: result.failed === 0, message: "Configured SharePoint sync completed", data: result } : result);
  } catch (error) {
    res.status(error instanceof MappingError ? error.status : 500).json({ message: error instanceof MappingError ? error.message : "Configured SharePoint sync failed. Check API logs." });
  }
}
