import { NextFunction, Request, Response, Router } from "express";
import { MappingError } from "../domain";
import { mappingRoute as route, positiveVersion, queryText, selectedMappingCodes, mappingId } from "../routing";
import { defaultSapMappings, parseSapConfig, sapModule, sapModules } from "./domain";
import { sapSourceColumns, stagingColumns } from "./metadata";
import { executeSapMapping, prepareSapMapping, previewSapMapping } from "./service";
import { sapMappingStore } from "./store";
import { describeSapQuery, testSapQuery } from "./query";

export const sapMappingsRouter = Router();
sapMappingsRouter.get("/", route(async (_req, res) => res.json({ saved: await sapMappingStore.savedMappings(), defaults: defaultSapMappings(), modules: sapModules })));
sapMappingsRouter.get("/columns", route(async (req, res) => {
  const module = sapModule(queryText(req, "module"));
  res.json({ source: sapSourceColumns(module), destination: await stagingColumns(module) });
}));
sapMappingsRouter.post("/columns", route(async (req, res) => {
  const module = sapModule(req.body.module);
  const [source, destination] = await Promise.all([describeSapQuery(req.body.query), stagingColumns(module)]);
  res.json({ source, destination });
}));
sapMappingsRouter.post("/test-query", route(async (req, res) => {
  sapModule(req.body.module);
  res.json(await testSapQuery(req.body.query));
}));
sapMappingsRouter.get("/:module/history", route(async (req, res) => {
  res.json(await sapMappingStore.mappingHistory(mappingId(req.params.module), req.query.beforeVersion === undefined ? undefined : positiveVersion(req.query.beforeVersion)));
}));
sapMappingsRouter.get("/:module/history/:version", route(async (req, res) => {
  res.json(await sapMappingStore.mappingVersion(mappingId(req.params.module), positiveVersion(req.params.version)));
}));
sapMappingsRouter.post("/validate-json", route(async (req, res) => res.json(parseSapConfig(req.body.config))));
sapMappingsRouter.post("/preview", route(async (req, res) => res.json(await previewSapMapping(req.body.config))));
sapMappingsRouter.put("/:module", route(async (req, res) => {
  const config = parseSapConfig(req.body.config);
  if (config.module !== req.params.module) throw new MappingError("The module in the URL and mapping must match.");
  const { version, enabled } = req.body;
  if (typeof enabled !== "boolean" || !Number.isSafeInteger(version) || version < 0) throw new MappingError("A boolean enabled flag and integer version are required.");
  await prepareSapMapping(config);
  if (enabled) {
    const preview = await previewSapMapping(config), bad = preview.rows.find(row => "error" in row);
    if (bad && "error" in bad) throw new MappingError(`Cannot enable SAP mapping: ${bad.error}`);
  }
  res.json(await sapMappingStore.saveMapping(config, enabled, version, req.user!.email));
}));
sapMappingsRouter.post("/:module/run", route(async (req, res) => {
  if (req.body.confirm !== true) throw new MappingError("Confirm the staging sync before running it.");
  res.json(await executeSapMapping(mappingId(req.params.module)));
}));
export async function configuredSapSync(req: Request, res: Response, next: NextFunction) {
  const match = /^\/(warehouse|item-class|uom|item)\/run(?:\/(single|multiple))?\/?$/.exec(req.path);
  if (req.method !== "POST" || !match) { next(); return; }
  try {
    let saved;
    try { saved = await sapMappingStore.savedMapping(match[1]!); }
    catch (error) {
      if ((error as { meta?: { code?: string } }).meta?.code === "208") { next(); return; }
      throw error;
    }
    if (!saved?.enabled) { next(); return; }
    const result = await executeSapMapping(match[1]!, selectedMappingCodes(req.body ?? {}, match[2]));
    res.json(match[1] === "item" ? { success: result.failed === 0, message: "Configured SAP item sync completed", data: result } : result);
  } catch (error) {
    if (!(error instanceof MappingError)) console.error("Configured SAP sync failed:", error instanceof Error ? error.message : String(error));
    res.status(error instanceof MappingError ? error.status : 500).json({ success: false, message: error instanceof MappingError ? error.message : "Configured SAP sync failed. Check API logs." });
  }
}
