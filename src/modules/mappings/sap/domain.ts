import { FieldRule, MappingBase, MappingError, parseMappingBase, validateMatchingKey } from "../domain";
import { validateSapQuery } from "./query";
import { sapQueries } from "./templates";

export const sapModules = {
  warehouse: { source: "OWHS", table: "dbo.Warehouses", key: "WhCode", description: "Existing OWHS query, including uppercase warehouse codes, names and addresses." },
  "item-class": { source: "OITB", table: "dbo.ItemClasses", key: "ItmsGrpCod", description: "Existing OITB query; U_Initials must not be null. Selected runs accept codes or initials. IsActive alone does not trigger an update." },
  uom: { source: "OUOM", table: "dbo.Uoms", key: "UomCode", description: "Existing OUOM query with uppercase, trimmed codes and descriptions." },
  item: { source: "OITM", table: "dbo.Items", key: "ItemCode", description: "Existing OITM/OITB/OUOM joins; validFor = Y and CreateDate >= 2026-04-22 for full and selected runs. Staging Item Class/UOM references and SAP flag normalization are preserved." },
} as const;
export type SapModule = keyof typeof sapModules;
export type SapMappingConfig = MappingBase & { syncModule?: string; source: MappingBase["source"] & { query?: string }; destination: { table: string; key: string } };
export type { StagingColumn } from "../staging-domain";
export function sapModule(value: string): SapModule {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(sapModules, value)) throw new MappingError("SAP mapping supports warehouse, item-class, uom and item only.");
  return value as SapModule;
}
export function sapConfigModule(config: SapMappingConfig): SapModule {
  const module = sapModule(config.syncModule ?? config.module);
  if (Object.prototype.hasOwnProperty.call(sapModules, config.module) && config.module !== module) throw new MappingError("An original mapping ID must keep its existing SAP module.");
  return module;
}
export function parseSapConfig(input: unknown): SapMappingConfig {
  const config = parseMappingBase(input) as SapMappingConfig;
  const binding = sapModules[sapConfigModule(config)];
  if (config.source.table !== binding.source || (!config.source.query && config.source.key !== binding.key) ||
      config.destination?.table !== binding.table || config.destination.key !== binding.key) {
    throw new MappingError("Use this module's existing SAP source, staging table and matching keys.");
  }
  if (config.source.query !== undefined) validateSapQuery(config.source.query);
  validateMatchingKey(config, config.destination.key);
  if (config.source.query && config.fields.find(field => field.target === config.destination.key)?.source !== config.source.key) throw new MappingError("Map the staging matching key from the selected query record key.");
  return config;
}
import { validateStagingSchema } from "../staging-domain";
import type { SourceColumn } from "../domain";
import type { StagingColumn } from "../staging-domain";
export function validateSapSchema(config: SapMappingConfig, source: SourceColumn[], destination: StagingColumn[]) {
  validateStagingSchema({ ...config, module: sapConfigModule(config) }, source, destination);
}
export { buildStagingPayload as buildSapPayload } from "../staging-domain";
const field = (source: string, target: string, transform: FieldRule["transform"] = "copy"): FieldRule => ({ source, target, transform });
export function defaultSapMappings(): SapMappingConfig[] {
  return (Object.keys(sapModules) as SapModule[]).map(module => {
    const binding = sapModules[module];
    const fields: FieldRule[] = module === "warehouse" ? [
      field("WhCode", "WhCode"), field("WhName", "WhName"), field("Address", "Address"),
      field("ResolvedIsActive", "IsActive"),
    ] : module === "item-class" ? [
      field("ItmsGrpCod", "ItmsGrpCod"), field("Initials", "Initials"), field("ItmsGrpNam", "ItmsGrpNam"),
      { source: "", target: "IsActive", transform: "constant", value: true },
    ] : module === "uom" ? [field("UomCode", "UomCode", "uppercase"), field("UomName", "UomName", "uppercase")] : [
      field("ItemCode", "ItemCode", "uppercase"), field("ItemDescription", "ItemDescription"), field("Category", "Category"),
      { source: "validFor", target: "IsActive", transform: "valueMap", values: { Y: true, N: false } },
      { source: "itemClassCode", target: "ItemClassCode", transform: "lookup", lookup: { table: "dbo.ItemClasses", match: "Initials", result: "ItmsGrpCod" } }, field("itemClassName", "ItemClassName"),
      field("UOM", "UOM"), { source: "UOM", target: "UOM_ID", transform: "lookup", lookup: { table: "dbo.Uoms", match: "UomCode", result: "Id" } }, field("ResolvedLeadTime", "LeadTime"),
      field("NormalizedWHInventory", "IsWHInventory"), field("NormalizedSalesInventory", "IsSalesInventory"), field("NormalizedPurchaseInventory", "IsPurchaseInventory"),
      field("ItemGroupName", "ItemGroupName"),
    ];
    return { schemaVersion: 1, module, name: `${module} → Staging`, source: { table: binding.source, query: sapQueries[module], key: binding.key, filters: [] }, destination: { table: binding.table, key: binding.key }, fields };
  });
}
