import { NextFunction, Request, Response, Router } from "express";
import { MappingError } from "../domain";
import { mappingRoute as route, positiveVersion, queryText, selectedMappingCodes, mappingId } from "../routing";
import { defaultItemMasterMappings, itemMasterModule, itemMasterModules, parseItemMasterConfig } from "./domain";
import { itemMasterColumns, itemMasterSourceColumns, itemMasterTables } from "./metadata";
import { sourceTables } from "../metadata";
import { executeItemMasterMapping, prepareItemMasterMapping, previewItemMasterMapping } from "./service";
import { itemMasterMappingStore } from "./store";

export const itemMasterMappingsRouter = Router();
itemMasterMappingsRouter.get("/", route(async (_req, res) => res.json({ saved: await itemMasterMappingStore.savedMappings(), defaults: defaultItemMasterMappings(), modules: itemMasterModules })));
itemMasterMappingsRouter.get("/tables", route(async (_req, res) => res.json({ source: await itemMasterTables(), destination: await sourceTables() })));
itemMasterMappingsRouter.get("/columns", route(async (req, res) => {
  itemMasterModule(queryText(req, "module"));
  const [source, destination] = await Promise.all([
    itemMasterSourceColumns(req.query.sourceTable === undefined ? "item_groups" : queryText(req, "sourceTable")),
    itemMasterColumns(req.query.destinationTable === undefined ? "dbo.ItemGroups" : queryText(req, "destinationTable")),
  ]);
  res.json({ source, destination });
}));
itemMasterMappingsRouter.get("/:module/history", route(async (req, res) => {
  res.json(await itemMasterMappingStore.mappingHistory(mappingId(req.params.module), req.query.beforeVersion === undefined ? undefined : positiveVersion(req.query.beforeVersion)));
}));
itemMasterMappingsRouter.get("/:module/history/:version", route(async (req, res) => {
  res.json(await itemMasterMappingStore.mappingVersion(mappingId(req.params.module), positiveVersion(req.params.version)));
}));
itemMasterMappingsRouter.post("/validate-json", route(async (req, res) => res.json(parseItemMasterConfig(req.body.config))));
itemMasterMappingsRouter.post("/preview", route(async (req, res) => res.json(await previewItemMasterMapping(req.body.config))));
itemMasterMappingsRouter.put("/:module", route(async (req, res) => {
  const config = parseItemMasterConfig(req.body.config);
  if (config.module !== req.params.module) throw new MappingError("The module in the URL and mapping must match.");
  const { version, enabled } = req.body;
  if (typeof enabled !== "boolean" || !Number.isSafeInteger(version) || version < 0) throw new MappingError("A boolean enabled flag and integer version are required.");
  await prepareItemMasterMapping(config);
  if (enabled) {
    const preview = await previewItemMasterMapping(config), bad = preview.rows.find(row => "error" in row);
    if (bad && "error" in bad) throw new MappingError(`Cannot enable Item Master mapping: ${bad.error}`);
  }
  res.json(await itemMasterMappingStore.saveMapping(config, enabled, version, req.user!.email));
}));
itemMasterMappingsRouter.post("/:module/run", route(async (req, res) => {
  if (req.body.confirm !== true) throw new MappingError("Confirm the staging sync before running it.");
  res.json(await executeItemMasterMapping(mappingId(req.params.module)));
}));

export async function configuredItemMasterSync(req: Request, res: Response, next: NextFunction) {
  const match = /^\/item-group\/run(?:\/(single|multiple))?\/?$/.exec(req.path);
  const aggregate = /^\/run\/?$/.test(req.path);
  if (req.method !== "POST" || (!match && !aggregate)) { next(); return; }
  try {
    let saved;
    try { saved = await itemMasterMappingStore.savedMapping("item-group"); }
    catch (error) {
      if ((error as { meta?: { code?: string } }).meta?.code === "208") { next(); return; }
      throw error;
    }
    if (!saved?.enabled) { next(); return; }
    const result = await executeItemMasterMapping("item-group", selectedMappingCodes(req.body ?? {}, match?.[1]));
    if (aggregate) {
      res.status(202).json({ module: "itemmaster-staging", entity: "item-group", status: result.status, startedAt: result.startedAt, endedAt: result.endedAt, result });
    } else res.json(result);
  } catch (error) {
    if (!(error instanceof MappingError)) console.error("Configured Item Master sync failed:", error instanceof Error ? error.message : String(error));
    res.status(error instanceof MappingError ? error.status : 500).json({ message: error instanceof MappingError ? error.message : "Configured Item Master sync failed. Check API logs." });
  }
}
