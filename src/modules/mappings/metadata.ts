import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { DestinationColumn, MappingConfig, MappingError, SourceColumn, buildLookup, lookupDatabase } from "./domain";
import { itemMasterTables, itemMasterTableColumns, readItemMasterLookupRows } from "./itemmaster/source";

type Table = { schema: string; name: string; id: string };
const identifier = (name: string) => `[${name.replace(/]/g, "]]")}]`;
let cachedToken: { token: string; expires: number } | undefined;
export async function accessToken() {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  const { tenantId, clientId, clientSecret } = env.sharePoint;
  if (!tenantId || !clientId || !clientSecret) throw new MappingError("SharePoint credentials are missing from the API environment.", 503);
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (!response.ok) throw new MappingError(`SharePoint authentication failed (${response.status}). Check the API credentials and application permissions.`, 502);
  const data = await response.json() as { access_token: string; expires_in: number };
  if (!data.access_token) throw new MappingError("SharePoint authentication did not return an access token.", 502);
  cachedToken = { token: data.access_token, expires: Date.now() + Math.max(0, data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

export async function graph<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  // Paths and pagination links must never send application credentials to another host.
  const url = path.startsWith("https://") ? new URL(path) : new URL(`https://graph.microsoft.com/v1.0/${path.replace(/^\//, "")}`);
  if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/")) throw new MappingError("Invalid Graph URL.");
  const response = await fetch(url, {
    ...init, signal: AbortSignal.timeout(30000), redirect: "error",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
  });
  if ([429, 503].includes(response.status) && attempt < 3) {
    const wait = Math.min(10000, Math.max(1000, Number(response.headers.get("retry-after") || 1) * 1000));
    await new Promise(resolve => setTimeout(resolve, wait));
    return graph<T>(path, init, attempt + 1);
  }
  if (!response.ok) {
    let detail = "";
    try { detail = ((await response.json()) as { error?: { message?: string } }).error?.message ?? ""; } catch { /* no JSON response */ }
    throw new MappingError(`SharePoint request failed (${response.status})${detail ? `: ${detail}` : "."}`, 502);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function collection<T>(path: string): Promise<T[]> {
  const values: T[] = [];
  let next: string | undefined = path;
  const seen = new Set<string>();
  while (next) {
    if (seen.has(next)) throw new MappingError("SharePoint returned a repeated pagination link.", 502);
    seen.add(next);
    const page: { value: T[]; "@odata.nextLink"?: string } = await graph(next);
    values.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return values;
}
export const listPath = (siteId: string, listId: string) => `sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}`;
export async function sourceTables(): Promise<Table[]> {
  const tables = await prisma.$queryRaw<Array<{ schema: string; name: string }>>`
    SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name] FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME`;
  return tables.filter(t => !/user|password|secret|token|audit|transactiontype|integrationmapping|^_/i.test(t.name))
    .map(t => ({ ...t, id: `${t.schema}.${t.name}` }));
}
export async function sourceTable(id: string) {
  const table = (await sourceTables()).find(t => t.id === id);
  if (!table) throw new MappingError("Source table is missing or unavailable for mapping. Refresh tables.");
  return table;
}
export async function sourceColumns(id: string): Promise<SourceColumn[]> {
  const table = await sourceTable(id);
  const columns = await prisma.$queryRaw<Array<{ name: string; type: string; nullable: string }>>`
    SELECT COLUMN_NAME AS [name], DATA_TYPE AS [type], IS_NULLABLE AS [nullable]
    FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ${table.schema} AND TABLE_NAME = ${table.name} ORDER BY ORDINAL_POSITION`;
  return columns.map(c => ({ ...c, nullable: c.nullable === "YES" }));
}
export async function readRows(tableId: string, columns: string[], filters: MappingConfig["source"]["filters"] = [], limit?: number) {
  const table = await sourceTable(tableId);
  const available = new Set((await sourceColumns(tableId)).map(c => c.name));
  if ([...columns, ...filters.map(f => f.column)].some(c => !available.has(c))) throw new MappingError("A selected source column no longer exists.");
  if (!columns.length) throw new MappingError("No source columns selected.");
  const where = filters.map(f => f.value === null
    ? Prisma.sql`${Prisma.raw(identifier(f.column))} IS NULL`
    : Prisma.sql`${Prisma.raw(identifier(f.column))} = ${f.value}`);
  return prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT ${limit ? Prisma.raw(`TOP (${Math.max(1, Math.min(100, Math.floor(limit)))})`) : Prisma.empty}
    ${Prisma.join([...new Set(columns)].map(c => Prisma.raw(identifier(c))))}
    FROM ${Prisma.raw(`${identifier(table.schema)}.${identifier(table.name)}`)}
    ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
    ORDER BY ${Prisma.raw(identifier(columns[0]!))}`);
}
type GraphColumn = {
  name: string; displayName: string; required?: boolean; readOnly?: boolean; hidden?: boolean;
  text?: { maxLength?: number }; choice?: { choices?: string[]; allowTextEntry?: boolean; displayAs?: string };
  number?: unknown; boolean?: unknown; currency?: unknown; dateTime?: unknown; defaultValue?: unknown;
};
export async function destinationColumns(siteId: string, listId: string): Promise<DestinationColumn[]> {
  const columns = await collection<GraphColumn>(`${listPath(siteId, listId)}/columns`);
  return columns.filter(c => !c.hidden).map(c => {
    const type = ["text", "number", "boolean", "choice", "dateTime", "currency"].find(key => key in c) ?? "unsupported";
    return { name: c.name, displayName: c.displayName, type, required: !!c.required, readOnly: !!c.readOnly,
      supported: type !== "unsupported" && c.choice?.displayAs !== "checkBoxes",
      choices: c.choice?.choices, allowTextEntry: c.choice?.allowTextEntry, maxLength: c.text?.maxLength, hasDefault: !!c.defaultValue };
  });
}
export async function loadLookups(config: Pick<MappingConfig, "fields">) {
  const lookups = new Map<string, Map<string, unknown>>();
  for (const rule of config.fields.filter(f => f.transform === "lookup")) {
    const spec = rule.lookup!;
    const database = lookupDatabase(spec.database);
    const key = JSON.stringify(spec);
    if (lookups.has(key)) continue;
    const rows = database === "itemmaster"
      ? await readItemMasterLookupRows(spec.table, [spec.match, spec.result])
      : await readRows(spec.table, [spec.match, spec.result]);
    lookups.set(key, buildLookup(rows, spec.match, spec.result));
  }
  return lookups;
}
export function lookupTables(database: unknown) {
  return lookupDatabase(database) === "itemmaster" ? itemMasterTables() : sourceTables();
}
export function lookupColumns(table: string, database: unknown) {
  return lookupDatabase(database) === "itemmaster" ? itemMasterTableColumns(table) : sourceColumns(table);
}
export function sourceFieldNames(config: MappingConfig) {
  return [config.source.key, ...config.fields.filter(f => !["constant", "uuid"].includes(f.transform)).map(f => f.source)];
}
