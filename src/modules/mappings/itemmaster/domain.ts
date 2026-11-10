import { MappingError, parseMappingBase, validateMatchingKey } from "../domain";
import { StagingMappingConfig } from "../staging-domain";

export type ItemMasterMappingConfig = StagingMappingConfig & { syncModule?: string };
export const itemMasterModules = {
  "item-group": {
    source: "item_groups", table: "dbo.ItemGroups", key: "ItemGroupID",
    description: "Item Groups with the existing Item Class join, uppercase values and non-null initials. Missing class values become empty text. Source columns are the built-in reader's named fields.",
  },
} as const;
export function itemMasterModule(value: string): "item-group" {
  if (value !== "item-group") throw new MappingError("Item Master mapping supports item-group only.");
  return value;
}
export function parseItemMasterConfig(input: unknown): ItemMasterMappingConfig {
  const config = parseMappingBase(input) as ItemMasterMappingConfig;
  itemMasterModule(config.syncModule ?? (config.module === "item-group" ? config.module : "item-group"));
  if (typeof config.destination?.table !== "string" || !config.destination.table.trim() ||
      typeof config.destination.key !== "string" || !config.destination.key.trim()) throw new MappingError("Choose a staging destination table and matching key.");
  if ("query" in config.source) throw new MappingError("Item Master mappings use table sources; custom SQL is unavailable.");
  validateMatchingKey(config, config.destination.key);
  const keyRule = config.fields.find(field => field.target === config.destination.key)!;
  if (keyRule.source !== config.source.key) throw new MappingError("Map the staging matching key from the selected source record key.");
  return config;
}
export function defaultItemMasterMappings(): ItemMasterMappingConfig[] {
  return [{
    schemaVersion: 1, module: "item-group", name: "Item Group → Staging",
    source: { table: "item_groups", key: "ItemGroupID", filters: [] },
    destination: { table: "dbo.ItemGroups", key: "ItemGroupID" },
    fields: [
      ...["ItemGroupID", "Initials", "Name", "ItemClassCode", "ItemClass", "Category"].map(name => ({ source: name, target: name, transform: "copy" as const })),
      { source: "", target: "IsActive", transform: "constant", value: true },
    ],
  }];
}
