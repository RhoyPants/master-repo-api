import { randomUUID } from "crypto";

export type Scalar = string | number | boolean | null;
export type LookupDatabase = "local" | "itemmaster";
export function lookupDatabase(value: unknown): LookupDatabase {
  if (value === undefined) return "local";
  if (value === "local" || value === "itemmaster") return value;
  throw new MappingError("Lookup database must be Local or Item Master.");
}
export type FieldRule = {
  source: string;
  target: string;
  transform: "copy" | "uppercase" | "lowercase" | "trim" | "number" | "boolean" | "valueMap" | "constant" | "uuid" | "lookup";
  value?: Scalar;
  values?: Record<string, Scalar>;
  lookup?: { database?: LookupDatabase; table: string; match: string; result: string };
  onMissing?: "error" | "null";
  write?: "always" | "create" | "update";
};
export type MappingBase = {
  schemaVersion: 1;
  module: string;
  name: string;
  source: { table: string; key: string; filters: Array<{ column: string; value: Scalar }> };
  fields: FieldRule[];
};
export type MappingConfig = MappingBase & { destination: { siteId: string; listId: string; key: string } };
export type SourceColumn = { name: string; type: string; nullable: boolean };
export type DestinationColumn = {
  name: string; displayName: string; type: string; required: boolean; readOnly: boolean;
  supported: boolean; choices?: string[]; allowTextEntry?: boolean; maxLength?: number;
  hasDefault?: boolean;
};
export class MappingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const transforms = new Set(["copy", "uppercase", "lowercase", "trim", "number", "boolean", "valueMap", "constant", "uuid", "lookup"]);
const scalar = (value: unknown): value is Scalar => value === null || ["string", "number", "boolean"].includes(typeof value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export const normalizedKey = (value: unknown) => String(value ?? "").trim().toUpperCase();

export function parseMappingBase(input: unknown): MappingBase {
  const c = input as MappingBase;
  if (!c || c.schemaVersion !== 1 || !text(c.name) || c.name.length > 150 || !text(c.module) || !/^[a-z][a-z0-9-]{0,49}$/.test(c.module)) {
    throw new MappingError("A mapping name, module and schemaVersion 1 are required.");
  }
  if (!text(c.source?.table) || !text(c.source?.key) || !Array.isArray(c.source.filters) || c.source.filters.length > 20 ||
      c.source.filters.some(f => !text(f.column) || !scalar(f.value))) throw new MappingError("Invalid source table, key or filters.");
  if (!Array.isArray(c.fields) || !c.fields.length || c.fields.length > 200) throw new MappingError("Add between 1 and 200 field mappings.");
  const targets = new Map<string, Set<string>>();
  for (const f of c.fields) {
    if (!f || !text(f.target) || !transforms.has(f.transform) || typeof f.source !== "string" ||
        (f.write && !["always", "create", "update"].includes(f.write)) ||
        (f.onMissing && !["error", "null"].includes(f.onMissing))) throw new MappingError("Invalid field mapping.");
    const scopes = f.write && f.write !== "always" ? [f.write] : ["create", "update"];
    const used = targets.get(f.target.toLowerCase()) ?? new Set<string>();
    if (scopes.some(scope => used.has(scope))) throw new MappingError(`Destination ${f.target} is mapped more than once for the same write mode.`);
    scopes.forEach(scope => used.add(scope));
    targets.set(f.target.toLowerCase(), used);
    if (!["constant", "uuid"].includes(f.transform) && !text(f.source)) throw new MappingError(`Choose a source column for ${f.target}.`);
    if (f.transform === "constant" && !scalar(f.value)) throw new MappingError(`Invalid constant for ${f.target}.`);
    if (f.transform === "valueMap" && (!f.values || Array.isArray(f.values) || typeof f.values !== "object" || !Object.values(f.values).every(scalar))) throw new MappingError(`Invalid value map for ${f.target}.`);
    if (f.transform === "valueMap") {
      const keys = Object.keys(f.values!).map(normalizedKey);
      if (new Set(keys).size !== keys.length) throw new MappingError(`Value rules for ${f.target} contain duplicate case-insensitive keys.`);
    }
    if (f.transform === "lookup" && (!text(f.lookup?.table) || !text(f.lookup?.match) || !text(f.lookup?.result))) throw new MappingError(`Complete the lookup for ${f.target}.`);
    if (f.transform === "lookup") lookupDatabase(f.lookup!.database);
  }
  return c;
}

export function validateMatchingKey(config: MappingBase, key: string) {
  const keyRule = config.fields.find(f => f.target === key);
  if (!keyRule || !keyRule.source || keyRule.write === "create" || keyRule.write === "update" ||
      ["constant", "uuid"].includes(keyRule.transform)) {
    throw new MappingError("Map the destination matching key from a source column for both create and update.");
  }
}

export function parseConfig(input: unknown): MappingConfig {
  const c = parseMappingBase(input) as MappingConfig;
  if (!text(c.destination?.siteId) || !text(c.destination?.listId) || !text(c.destination?.key)) throw new MappingError("Choose a SharePoint site, list and matching field.");
  validateMatchingKey(c, c.destination.key);
  return c;
}

export function validateSchema(config: MappingConfig, source: SourceColumn[], destination: DestinationColumn[]) {
  const sourceNames = new Set(source.map(c => c.name));
  for (const column of [config.source.key, ...config.source.filters.map(f => f.column), ...config.fields.filter(f => !["constant", "uuid"].includes(f.transform)).map(f => f.source)]) {
    if (!sourceNames.has(column)) throw new MappingError(`Source column ${column} no longer exists. Refresh columns and remap.`);
  }
  for (const field of config.fields) {
    const column = destination.find(c => c.name === field.target);
    if (!column) throw new MappingError(`SharePoint field ${field.target} no longer exists. Refresh columns and remap.`);
    if (column.readOnly || !column.supported) throw new MappingError(`SharePoint field ${field.target} is read-only or uses an unsupported type.`);
  }
  for (const column of destination.filter(c => c.required && !c.readOnly && !c.hasDefault)) {
    if (!config.fields.some(f => f.target === column.name && f.write !== "update")) throw new MappingError(`Required SharePoint field ${column.displayName} must be mapped for new records.`);
  }
  const key = destination.find(c => c.name === config.destination.key);
  if (!key || !["text", "number"].includes(key.type)) throw new MappingError("The SharePoint matching field must be text or number.");
}

export function toBoolean(value: unknown): boolean {
  if ([true, 1, "1"].includes(value as never)) return true;
  if ([false, 0, "0"].includes(value as never)) return false;
  const v = normalizedKey(value);
  if (["Y", "YES", "TRUE"].includes(v)) return true;
  if (["N", "NO", "FALSE"].includes(v)) return false;
  throw new MappingError(`Cannot convert ${String(value)} to boolean.`);
}

export function transformValue(rule: FieldRule, row: Record<string, unknown>, lookups: Map<string, Map<string, unknown>>): unknown {
  const value = row[rule.source];
  switch (rule.transform) {
    case "constant": return rule.value;
    case "uuid": return randomUUID();
    case "valueMap": {
      const entry = Object.entries(rule.values ?? {}).find(([key]) => normalizedKey(key) === normalizedKey(value));
      if (entry) return entry[1];
      if (rule.onMissing === "null") return null;
      throw new MappingError(`No value rule for ${rule.target}: ${String(value)}.`);
    }
    case "lookup": {
      const l = rule.lookup!;
      const index = lookups.get(JSON.stringify(l));
      if (index?.has(normalizedKey(value))) return index.get(normalizedKey(value));
      if (rule.onMissing === "null") return null;
      throw new MappingError(`Lookup not found for ${rule.target}: ${String(value)}.`);
    }
    default:
      if (value === null || value === undefined) return null;
      if (rule.transform === "uppercase") return String(value).trim().toUpperCase();
      if (rule.transform === "lowercase") return String(value).trim().toLowerCase();
      if (rule.transform === "trim") return String(value).trim();
      if (rule.transform === "boolean") return toBoolean(value);
      if (rule.transform === "number") {
        if (typeof value === "string" && !value.trim()) throw new MappingError(`Empty number for ${rule.target}.`);
        const number = Number(value);
        if (!Number.isFinite(number)) throw new MappingError(`Invalid number for ${rule.target}.`);
        return number;
      }
      return value instanceof Date ? value.toISOString() : typeof value === "bigint" ? String(value) : value;
  }
}

export function buildPayload(config: MappingConfig, row: Record<string, unknown>, columns: DestinationColumn[], lookups: Map<string, Map<string, unknown>>, mode: "create" | "update") {
  const result: Record<string, unknown> = {};
  for (const rule of config.fields) {
    if (rule.write && rule.write !== "always" && rule.write !== mode) continue;
    const value = transformValue(rule, row, lookups);
    const column = columns.find(c => c.name === rule.target)!;
    if (value == null) {
      if (column.required) throw new MappingError(`${column.displayName} is required.`);
    } else if (column.type === "number" || column.type === "currency") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new MappingError(`${column.displayName} requires a number. Choose the number rule.`);
    } else if (column.type === "boolean" && typeof value !== "boolean") throw new MappingError(`${column.displayName} requires a boolean.`);
    else if (["text", "choice", "dateTime"].includes(column.type)) {
      if (typeof value !== "string") throw new MappingError(`${column.displayName} requires text. Choose a text or value rule.`);
      if (column.maxLength && value.length > column.maxLength) throw new MappingError(`${column.displayName} exceeds ${column.maxLength} characters.`);
      if (column.type === "choice" && !column.allowTextEntry && !column.choices?.includes(value)) throw new MappingError(`${value} is not an allowed choice for ${column.displayName}.`);
      if (column.type === "dateTime" && !Number.isFinite(Date.parse(value))) throw new MappingError(`${column.displayName} requires a valid date.`);
    }
    result[rule.target] = value;
  }
  const key = result[config.destination.key];
  if (key == null || String(key).trim() === "") throw new MappingError("The matching key cannot be empty.");
  return result;
}

export function buildLookup(rows: Record<string, unknown>[], match: string, result: string) {
  const index = new Map<string, unknown>();
  for (const row of rows) {
    const key = normalizedKey(row[match]);
    if (!key) continue;
    if (index.has(key) && index.get(key) !== row[result]) throw new MappingError(`Ambiguous lookup: ${match} has multiple results for ${key}.`);
    index.set(key, row[result]);
  }
  return index;
}
