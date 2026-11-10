import { getItemMasterPool } from "../../../lib/itemMaster";
import { MappingError, SourceColumn } from "../domain";

type Table = { schema: string; name: string; id: string };
const identifier = (value: string) => '[' + value.replace(/]/g, ']]') + ']';
const available = (name: string) => !/user|password|secret|token|audit|transactiontype|integrationmapping|^_/i.test(name);

export async function itemMasterTables(): Promise<Table[]> {
  const result = await (await getItemMasterPool()).request().query<{ schema: string; name: string }>(
    "SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name] FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME");
  return result.recordset.filter(table => available(table.name)).map(table => ({ ...table, id: table.schema + '.' + table.name }));
}
export async function itemMasterTable(id: string) {
  const table = (await itemMasterTables()).find(table => table.id === id);
  if (!table) throw new MappingError("Item Master source table is missing or unavailable. Refresh tables.");
  return table;
}
export async function itemMasterTableColumns(tableId: string): Promise<SourceColumn[]> {
  const table = await itemMasterTable(tableId);
  const result = await (await getItemMasterPool()).request().input("schema", table.schema).input("table", table.name).query<{ name: string; type: string; nullable: string }>(
    "SELECT COLUMN_NAME AS [name], DATA_TYPE AS [type], IS_NULLABLE AS [nullable] FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table ORDER BY ORDINAL_POSITION");
  return result.recordset.map(column => ({ ...column, nullable: column.nullable === "YES" }));
}
export async function readItemMasterLookupRows(tableId: string, columns: string[]) {
  const table = await itemMasterTable(tableId);
  const available = new Set((await itemMasterTableColumns(tableId)).map(column => column.name));
  if (!columns.length || columns.some(column => !available.has(column))) throw new MappingError("A selected Item Master lookup column no longer exists. Refresh columns.");
  const result = await (await getItemMasterPool()).request().query<Record<string, unknown>>(
    "SELECT " + [...new Set(columns)].map(identifier).join(", ") +
    " FROM " + identifier(table.schema) + "." + identifier(table.name));
  return result.recordset;
}
