import { Prisma } from "@prisma/client";
import { getItemMasterPool } from "../../../lib/itemMaster";
import { MappingError, SourceColumn, normalizedKey } from "../domain";
import { sourceTables } from "../metadata";
import { stagingTableColumns } from "../staging-metadata";
import { fetchItemMasterRows } from "../../sync/itemMaster-staging/item-group/service";
import { ItemMasterMappingConfig } from "./domain";
import { itemMasterTable as sourceTable, itemMasterTableColumns } from "./source";
export { itemMasterTables } from "./source";

const identifier = (value: string) => '[' + value.replace(/]/g, ']]') + ']';
export async function itemMasterSourceColumns(tableId = "item_groups"): Promise<SourceColumn[]> {
  // Existing snapshots keep the joined reader as an explicitly named preset.
  if (tableId === "item_groups") return ["ItemGroupID", "Initials", "Name", "ItemClassCode", "ItemClass", "Category"].map(name => ({ name, type: "text", nullable: name === "Category" }));
  return itemMasterTableColumns(tableId);
}
export async function itemMasterDestination(tableId: string) {
  const table = (await sourceTables()).find(table => table.id === tableId);
  if (!table) throw new MappingError("Staging destination table is missing or unavailable. Refresh tables.");
  return { ...table, sql: Prisma.raw(identifier(table.schema) + '.' + identifier(table.name)) };
}
export async function itemMasterColumns(tableId = "dbo.ItemGroups") {
  const table = await itemMasterDestination(tableId);
  const columns = await stagingTableColumns(table.name, table.schema);
  if (!columns.length) throw new MappingError("Staging destination columns are unavailable. Refresh tables.");
  return columns;
}
export async function readItemMasterRows(config: ItemMasterMappingConfig, codes?: string[]) {
  const requestedCodes = codes ? [...new Set(codes.map(normalizedKey))] : undefined;
  let records: Array<Record<string, unknown>>;
  if (config.source.table === "item_groups") {
    records = (await fetchItemMasterRows()).map(row => ({ ...row, ItemClassCode: row.ItemClassCode ?? "", ItemClass: row.ItemClass ?? "" }));
  } else {
    const table = await sourceTable(config.source.table);
    const columns = await itemMasterSourceColumns(config.source.table);
    const names = [...new Set([config.source.key, ...config.source.filters.map(filter => filter.column),
      ...config.fields.filter(field => !["constant", "uuid"].includes(field.transform)).map(field => field.source)])];
    if (names.some(name => !columns.some(column => column.name === name))) throw new MappingError("A selected Item Master source column is unavailable. Refresh columns.");
    const result = await (await getItemMasterPool()).request().query<Record<string, unknown>>("SELECT TOP (50001) " + names.map(identifier).join(", ") +
      " FROM " + identifier(table.schema) + '.' + identifier(table.name) + " ORDER BY " + identifier(config.source.key));
    records = result.recordset;
    if (records.length > 50000) throw new MappingError("Item Master source exceeds 50,000 rows. No staging records were written.");
  }
  return { rows: records.filter(row => !requestedCodes || requestedCodes.includes(normalizedKey(row[config.source.key]))), requestedCodes };
}
