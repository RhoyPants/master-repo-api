import sql from "mssql";
import { Parser } from "node-sql-parser";
import { getSapQueryPool } from "../../../lib/sap";
import { MappingError, SourceColumn } from "../domain";

const parser = new Parser();
const options = { database: "TransactSQL" };
const functions = new Set(["UPPER", "LOWER", "LTRIM", "RTRIM", "TRIM", "ISNULL", "COALESCE", "NULLIF", "CONCAT", "CONCAT_WS", "SUBSTRING", "LEFT", "RIGHT", "LEN", "DATALENGTH", "REPLACE", "CHARINDEX", "PATINDEX", "STUFF", "REPLICATE", "REVERSE", "FORMAT", "IIF", "CHOOSE", "CONVERT", "TRY_CONVERT", "TRY_CAST", "ABS", "ROUND", "CEILING", "FLOOR", "POWER", "SQRT", "COUNT", "SUM", "AVG", "MIN", "MAX", "GETDATE", "GETUTCDATE", "SYSDATETIME", "SYSUTCDATETIME", "DATEADD", "DATEDIFF", "DATEDIFF_BIG", "DATEPART", "DATENAME", "YEAR", "MONTH", "DAY", "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE", "STRING_AGG"]);
const dataTypes = new Set(["BIT", "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT", "DECIMAL", "NUMERIC", "FLOAT", "REAL", "MONEY", "SMALLMONEY", "CHAR", "VARCHAR", "TEXT", "NCHAR", "NVARCHAR", "NTEXT", "BINARY", "VARBINARY", "IMAGE", "DATE", "TIME", "DATETIME", "DATETIME2", "SMALLDATETIME", "DATETIMEOFFSET", "UNIQUEIDENTIFIER", "XML", "SQL_VARIANT"]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function inspect(node: unknown): void {
  if (Array.isArray(node)) { node.forEach(inspect); return; }
  if (!object(node)) return;
  if (typeof node.dataType === "string" && !dataTypes.has(node.dataType.toUpperCase())) throw new MappingError("Custom SQL/CLR data types are unavailable.");
  if (["insert", "update", "delete", "replace", "merge", "create", "drop", "alter", "exec", "call", "assign", "var", "param"].includes(String(node.type))) {
    throw new MappingError("Only a single read-only SELECT query is allowed. Variables and executable statements are unavailable.");
  }
  if (object(node.into) && node.into.position != null) throw new MappingError("SELECT INTO is not allowed.");
  if (node.type === "column_ref" && String(node.column).startsWith("@")) throw new MappingError("SQL variables and assignments are unavailable.");
  if (node.type === "select" && node.for) throw new MappingError("Return normal tabular columns, not FOR XML/JSON.");
  if (!node.type && typeof node.table === "string" && (node.schema || node.server || node.table.startsWith("#"))) {
    throw new MappingError("Use tables/views in the connected SAP database only; cross-database, linked-server and temporary sources are unavailable.");
  }
  if (node.type === "function") {
    const name = object(node.name) ? node.name : {};
    const parts = Array.isArray(name.name) ? name.name : [];
    const value = parts.length === 1 && object(parts[0]) ? String(parts[0].value).toUpperCase() : "";
    if (name.schema || !functions.has(value)) throw new MappingError(`SQL function ${value || "(qualified/external)"} is unavailable. Use supported read-only built-in functions.`);
  }
  Object.values(node).forEach(inspect);
}
export function validateSapQuery(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 50000) throw new MappingError("Paste a SELECT query of up to 50,000 characters.");
  try {
    const parsed = parser.astify(input, options);
    const statements = Array.isArray(parsed) ? parsed : [parsed];
    if (statements.length !== 1 || statements[0]?.type !== "select") throw new MappingError("Only one SELECT query (optionally with CTEs) is allowed.");
    inspect(statements[0]);
    return parser.sqlify(statements[0]!, options);
  } catch (error) {
    if (error instanceof MappingError) throw error;
    throw new MappingError(`Unsupported or invalid SELECT syntax: ${error instanceof Error ? error.message.slice(0, 400) : String(error)}.`);
  }
}
type Description = { name: string | null; system_type_name: string | null; is_nullable: boolean; is_hidden: boolean };
export async function describeSapQuery(query: unknown): Promise<SourceColumn[]> {
  const canonical = validateSapQuery(query);
  const request = (await getSapQueryPool()).request();
  try {
    const result = await request.input("query", sql.NVarChar(sql.MAX), canonical).query<Description>(
      "EXEC sys.sp_describe_first_result_set @tsql = @query, @params = NULL, @browse_information_mode = 0");
    const names = new Set<string>();
    const columns = result.recordset.filter(column => !column.is_hidden).map(column => {
      const name = column.name;
      if (!name?.trim()) throw new MappingError("Every output column needs a name. Add AS aliases to computed expressions.");
      if (names.has(name.toUpperCase()) || ["__proto__", "constructor", "prototype"].includes(name.toLowerCase())) throw new MappingError(`Duplicate or reserved output column ${name}. Use unique aliases.`);
      names.add(name.toUpperCase());
      return { name, type: column.system_type_name ?? "unknown", nullable: column.is_nullable };
    });
    if (!columns.length || columns.length > 200) throw new MappingError("Return between 1 and 200 uniquely named columns.");
    return columns;
  } catch (error) {
    if (error instanceof sql.RequestError) throw new MappingError(`SAP query check failed: ${error.message}`, error.code === "ETIMEOUT" ? 504 : 400);
    throw error;
  }
}
export async function executeSapQuery(query: string, sample = false): Promise<Array<Record<string, unknown>>> {
  const canonical = validateSapQuery(query);
  const request = (await getSapQueryPool()).request();
  request.stream = true;
  const rows: Array<Record<string, unknown>> = [];
  const limit = sample ? 5 : 50001;
  let cancelled = false;
  let streamError: Error | undefined;
  request.on("row", (row: Record<string, unknown>) => {
    if (cancelled) return;
    rows.push(row);
    if (rows.length >= limit) { cancelled = true; request.cancel(); }
  });
  request.on("error", (error: Error) => {
    if (!(cancelled && error instanceof sql.RequestError && error.code === "ECANCEL")) streamError = error;
  });
  try { await request.query(canonical); }
  catch (error) {
    if (!(cancelled && error instanceof sql.RequestError && error.code === "ECANCEL")) {
      if (error instanceof sql.RequestError) throw new MappingError(`SAP query failed: ${error.message}`, error.code === "ETIMEOUT" ? 504 : 400);
      throw error;
    }
    if (streamError instanceof sql.RequestError) throw new MappingError(`SAP query failed: ${streamError.message}`, streamError.code === "ETIMEOUT" ? 504 : 400);
    if (streamError) throw streamError;
  }
  if (!sample && rows.length > 50000) throw new MappingError("SAP query returned more than 50,000 rows. Narrow the query before syncing; no staging records were written.");
  return rows;
}
export async function testSapQuery(query: unknown) {
  const columns = await describeSapQuery(query);
  const rows = await executeSapQuery(String(query), true);
  return { columns, rows, sampleCount: rows.length, message: "Query checked against SAP. Up to 5 source records shown; no staging writes or configuration saves." };
}
