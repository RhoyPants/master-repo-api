import { MappingBase, MappingError, SourceColumn, normalizedKey, transformValue } from "./domain";

export type StagingMappingConfig = MappingBase & { destination: { table: string; key: string } };
export type StagingColumn = {
  name: string; type: string; nullable: boolean; readOnly: boolean; supported: boolean; hasDefault: boolean; maxLength?: number;
};

export function validateStagingSchema(config: StagingMappingConfig, source: SourceColumn[], destination: StagingColumn[]) {
  const names = new Set(source.map(column => column.name));
  for (const name of [config.source.key, ...config.source.filters.map(filter => filter.column), ...config.fields.filter(rule => !["constant", "uuid"].includes(rule.transform)).map(rule => rule.source)]) {
    if (!names.has(name)) throw new MappingError(`Source field ${name} is unavailable. Refresh columns and remap.`);
  }
  for (const rule of config.fields) {
    const column = destination.find(column => column.name === rule.target);
    if (!column || column.readOnly || !column.supported) throw new MappingError(`Staging field ${rule.target} is missing, managed automatically, or unsupported.`);
  }
  for (const column of destination.filter(column => !column.nullable && !column.hasDefault && !column.readOnly)) {
    if (!config.fields.some(rule => rule.target === column.name && rule.write !== "update")) throw new MappingError(`Required staging field ${column.name} must be mapped for creates.`);
  }
  if (config.module === "item") for (const mode of ["create", "update"]) {
    const targets = new Set(config.fields.filter(rule => !rule.write || rule.write === "always" || rule.write === mode).map(rule => rule.target));
    if (targets.has("UOM") !== targets.has("UOM_ID")) throw new MappingError(`Map Item UOM and UOM_ID together for ${mode}s.`);
  }
}
export function buildStagingPayload(config: StagingMappingConfig, row: Record<string, unknown>, columns: StagingColumn[], lookups: Map<string, Map<string, unknown>>, mode: "create" | "update") {
  const payload: Record<string, string | number | boolean | null> = {};
  for (const rule of config.fields.filter(rule => !rule.write || rule.write === "always" || rule.write === mode)) {
    const column = columns.find(column => column.name === rule.target);
    if (!column) throw new MappingError(`Staging field ${rule.target} no longer exists.`);
    let value = transformValue(rule, row, lookups);
    if (value === null || value === undefined) {
      if (!column.nullable) throw new MappingError(`Staging field ${rule.target} is required.`);
      payload[rule.target] = null; continue;
    }
    if (["nvarchar", "varchar", "nchar", "char", "uniqueidentifier"].includes(column.type)) {
      const text = String(value);
      if (column.maxLength && text.length > column.maxLength) throw new MappingError(`Staging field ${rule.target} exceeds ${column.maxLength} characters.`);
      if (column.type === "uniqueidentifier" && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text)) throw new MappingError(`Staging field ${rule.target} requires a UUID.`);
      value = text;
    } else if (column.type === "bit") {
      if (typeof value !== "boolean") throw new MappingError(`Staging field ${rule.target} requires a boolean conversion.`);
    } else {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new MappingError(`Staging field ${rule.target} requires a number conversion.`);
      const ranges: Record<string, [number, number]> = { tinyint: [0, 255], smallint: [-32768, 32767], int: [-2147483648, 2147483647] };
      if (ranges[column.type] && (!Number.isInteger(value) || value < ranges[column.type][0] || value > ranges[column.type][1])) throw new MappingError(`Staging field ${rule.target} is outside its integer range.`);
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new MappingError(`Invalid value for staging field ${rule.target}.`);
    payload[rule.target] = value;
  }
  if (!normalizedKey(payload[config.destination.key])) throw new MappingError("The staging matching key cannot be empty.");
  return payload;
}
