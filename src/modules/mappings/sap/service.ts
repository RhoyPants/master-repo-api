import { auditActorData } from "../../../lib/audit-context";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { MappingError, normalizedKey } from "../domain";
import { SapMappingConfig, buildSapPayload, parseSapConfig, sapConfigModule, validateSapSchema } from "./domain";
import { identifier, itemReferenceMaps, mappingSourceColumns, readMappingRows, sapLookups, stagingColumns, tableSql } from "./metadata";
import { sapMappingStore } from "./store";

export async function prepareSapMapping(input: unknown) {
  const config = parseSapConfig(input), module = sapConfigModule(config);
  const [columns, lookups, sourceColumns] = await Promise.all([stagingColumns(module), sapLookups(config), mappingSourceColumns(config)]);
  validateSapSchema(config, sourceColumns, columns);
  return { config, module, columns, lookups };
}
const eligible = (config: SapMappingConfig, rows: Array<Record<string, unknown>>) => rows.filter(row => config.source.filters.every(filter =>
  filter.value === null ? row[filter.column] === null : normalizedKey(row[filter.column]) === normalizedKey(filter.value)));
function validateItemPayload(payload: ReturnType<typeof buildSapPayload>, references: Awaited<ReturnType<typeof itemReferenceMaps>>, key: string) {
  if (payload.ItemClassCode != null && !references.itemClassCodeSet.has(normalizedKey(payload.ItemClassCode))) throw new MappingError(`Missing staging Item Class for ${key}. No staging records were written.`);
  if (payload.UOM != null && !references.uomCodeToId.has(normalizedKey(payload.UOM))) throw new MappingError(`Missing staging UOM for ${key}. No staging records were written.`);
  if (payload.UOM_ID != null && ![...references.uomCodeToId.values()].includes(Number(payload.UOM_ID))) throw new MappingError(`Missing staging UOM ID for ${key}. No staging records were written.`);
  if ((payload.UOM == null) !== (payload.UOM_ID == null) ||
      (payload.UOM != null && references.uomCodeToId.get(normalizedKey(payload.UOM)) !== payload.UOM_ID)) {
    throw new MappingError(`Item UOM and UOM_ID do not identify the same staging UOM for ${key}. No staging records were written.`);
  }
}
export async function previewSapMapping(input: unknown) {
  const { config, module, columns, lookups } = await prepareSapMapping(input);
  const { rows } = await readMappingRows(config, undefined, true);
  const sample = eligible(config, rows).slice(0, 5);
  const references = module === "item" ? await itemReferenceMaps() : undefined;
  return {
    valid: true, sampleCount: sample.length,
    message: sample.length ? "SAP source query and staging schema checked. Preview does not write to staging." : "Schema checked. No SAP rows match the source query and configured filters.",
    rows: sample.map(row => {
      try {
        if (row.sourceError) throw new MappingError(String(row.sourceError));
        const create = buildSapPayload(config, row, columns, lookups, "create"), update = buildSapPayload(config, row, columns, lookups, "update");
        if (references) for (const payload of [create, update]) validateItemPayload(payload, references, String(row[config.source.key]));
        return { key: row[config.source.key], source: row, create, update };
      } catch (error) { return { key: row[config.source.key], source: row, error: error instanceof Error ? error.message : String(error) }; }
    }),
  };
}
const running = new Set<string>();
const comparable = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
export async function executeSapMapping(moduleId: string, codes?: string[]) {
  const saved = await sapMappingStore.savedMapping(moduleId);
  if (!saved?.enabled) throw new MappingError("Save and enable this SAP mapping before running it.");
  const module = sapConfigModule(saved.config);
  if (running.has(module)) throw new MappingError("Another configured sync is running for this staging table.", 409);
  running.add(module);
  try {
    const { config, columns, lookups } = await prepareSapMapping(saved.config);
    const source = await readMappingRows(config, codes);
    const rows = eligible(config, source.rows), keys = new Set<string>(), sourceKeys = new Set<string>();
    const references = module === "item" ? await itemReferenceMaps() : undefined;
    const prepared = rows.map(row => {
      if (row.sourceError) throw new MappingError(`${String(row[config.source.key])}: ${String(row.sourceError)}. No staging records were written.`);
      const sourceKey = normalizedKey(row[config.source.key]);
      if (!sourceKey || sourceKeys.has(sourceKey)) throw new MappingError("Duplicate or empty SAP source key. No staging records were written.");
      sourceKeys.add(sourceKey);
      const create = buildSapPayload(config, row, columns, lookups, "create"), update = buildSapPayload(config, row, columns, lookups, "update");
      const key = normalizedKey(create[config.destination.key]);
      if (keys.has(key) || key !== normalizedKey(update[config.destination.key])) throw new MappingError("Duplicate or inconsistent staging matching keys. No staging records were written.");
      keys.add(key);
      if (references) for (const payload of [create, update]) validateItemPayload(payload, references, sourceKey);
      return { code: String(row[config.source.key]), key, initials: String(row.Initials ?? ""), create, update };
    });
    const table = tableSql(module), keyColumn = Prisma.raw(identifier(config.destination.key));
    const existingKeys = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT ${keyColumn} FROM ${table}`;
    const existing = new Set<string>();
    for (const row of existingKeys) {
      const key = normalizedKey(row[config.destination.key]);
      if (key && existing.has(key)) throw new MappingError("Duplicate normalized staging keys. Resolve duplicates before syncing.");
      if (key) existing.add(key);
    }
    const runId = randomUUID(), startedAt = new Date();
    const transactionCode = `SAP2SDB_${module === "item-class" ? "ITEMCLASS" : module.toUpperCase()}${codes ? "_SELECTED" : ""}`;
    const transaction = await prisma.transactionType.upsert({ where: { code: transactionCode }, update: {}, create: { code: transactionCode, isActive: true } });
    const audit = await prisma.auditLog.create({ data: { ...auditActorData(), transactionTypeId: transaction.id, runId, startedAt, status: "RUNNING", totalRecords: prepared.length } });
    let inserted = 0, updated = 0, skipped = 0, failed = 0;
    const items: Array<Record<string, unknown>> = [];
    try {
      await prisma.auditLogDetail.create({ data: { auditLogId: audit.id, level: "INFO", step: "MAPPING", message: `SAP mapping ${config.module} (${module}) version ${saved.version}; ${config.source.query ? "saved SQL" : "built-in"} source; ${config.destination.table}` } });
      for (const row of prepared) {
        let action = "UPSERT", errorMessage: string | undefined;
        let changes: Array<{ field: string; from: unknown; to: unknown }> = [];
        try {
          const result = await prisma.$transaction(async tx => {
            const selected = Prisma.join([...new Set([config.destination.key, ...Object.keys(row.update)])].map(name => Prisma.raw(identifier(name))));
            const current = await tx.$queryRaw<Array<Record<string, unknown>>>`
              SELECT ${selected} FROM ${table} WITH (UPDLOCK, HOLDLOCK)
              WHERE UPPER(LTRIM(RTRIM(CONVERT(NVARCHAR(450), ${keyColumn})))) = ${row.key}`;
            if (current.length > 1) throw new MappingError("Staging matching key is duplicated.");
            if (!current[0]) {
              const payload = { ...row.create, ...(module === "item" && columns.some(column => column.name === "UpdatedAt") ? { UpdatedAt: new Date() } : {}) };
              await tx.$executeRaw`INSERT INTO ${table} (${Prisma.join(Object.keys(payload).map(name => Prisma.raw(identifier(name))))})
                VALUES (${Prisma.join(Object.values(payload).map(value => Prisma.sql`${value}`))})`;
              return { action: "INSERT", changes: [] };
            }
            const changes = Object.entries(row.update).filter(([name, value]) => name !== config.destination.key &&
              !(module === "item-class" && name === "IsActive") && comparable(current[0]![name]) !== comparable(value))
              .map(([field, to]) => ({ field, from: current[0]![field], to }));
            if (!changes.length) return { action: "SKIP", changes };
            const payload = { ...row.update, ...(columns.some(column => column.name === "UpdatedAt") ? { UpdatedAt: new Date() } : {}) };
            const assignments = Object.entries(payload).filter(([name]) => name !== config.destination.key).map(([name, value]) => Prisma.sql`${Prisma.raw(identifier(name))} = ${value}`);
            const changed = await tx.$executeRaw`UPDATE ${table} SET ${Prisma.join(assignments)}
              WHERE UPPER(LTRIM(RTRIM(CONVERT(NVARCHAR(450), ${keyColumn})))) = ${row.key}`;
            if (changed !== 1) throw new MappingError("Staging record changed during sync.");
            return { action: "UPDATE", changes };
          });
          action = result.action; changes = result.changes;
          if (action === "INSERT") inserted++; else if (action === "UPDATE") updated++; else skipped++;
        } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); failed++; }
        const status = errorMessage ? "FAILED" : "SUCCESS";
        const codeField = module === "warehouse" ? "whCode" : module === "item-class" ? "itmsGrpCod" : module === "uom" ? "uomCode" : "code";
        items.push({ code: row.code, [codeField]: row.code, ...(module === "item-class" ? { initials: row.initials } : {}), action, status, changes, ...(errorMessage ? { error: errorMessage } : {}) });
        await prisma.auditTransactionItem.create({ data: { auditLogId: audit.id, entity: module, referenceKey: row.code.slice(0, 100), action, status, errorMessage: errorMessage?.slice(0, 1000), payload: JSON.stringify({ mappingId: config.module, mappingVersion: saved.version, changes, ...(action === "INSERT" && !errorMessage ? { values: row.create } : {}) }) } });
      }
      const status = failed ? inserted + updated + skipped ? "PARTIAL" : "FAILED" : "SUCCESS";
      const endedAt = new Date();
      await prisma.auditLog.update({ where: { id: audit.id }, data: { status, endedAt, insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed } });
      const matched = new Set(rows.flatMap(row => [normalizedKey(row[config.source.key]), ...(module === "item-class" ? [normalizedKey(row.Initials)] : [])]));
      const missingCodes = source.requestedCodes?.filter(code => !matched.has(code)) ?? [];
      return {
        runId, source: "sap-staging", entity: module, module, mappingId: saved.config.module, mappingVersion: saved.version, status,
        startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), totalRecords: prepared.length, totalRows: prepared.length,
        inserted, updated, skipped, failed, insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed,
        processedCount: inserted + updated, successCount: inserted + updated + skipped, items, data: items,
        failedRows: items.filter(item => item.status === "FAILED"), requestedCodes: source.requestedCodes, foundCodes: prepared.map(row => row.code), missingCodes,
        missingDetails: missingCodes.map(code => ({ code, ...(module === "warehouse" ? { whCode: code } : {}), status: "NOT_FOUND", reason: "Not found in the existing SAP query or excluded by mapping filters" })),
      };
    } catch (error) {
      await prisma.auditLog.update({ where: { id: audit.id }, data: { status: "FAILED", endedAt: new Date(), errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 1000), insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed } });
      throw error;
    }
  } finally { running.delete(module); }
}
