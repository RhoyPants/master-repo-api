import { auditActorData } from "../../../lib/audit-context";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { MappingError, normalizedKey } from "../domain";
import { ItemMasterMappingConfig, parseItemMasterConfig, itemMasterModule } from "./domain";
import { buildStagingPayload, validateStagingSchema } from "../staging-domain";
import { loadLookups } from "../metadata";
import { itemMasterSourceColumns, readItemMasterRows, itemMasterColumns, itemMasterDestination } from "./metadata";
import { itemMasterMappingStore } from "./store";

const identifier = (value: string) => `[${value.replace(/]/g, "]]")}]`;

export async function prepareItemMasterMapping(input: unknown) {
  const config = parseItemMasterConfig(input), module = itemMasterModule(config.syncModule ?? "item-group");
  const [columns, lookups, sourceColumns, destination] = await Promise.all([itemMasterColumns(config.destination.table), loadLookups(config), itemMasterSourceColumns(config.source.table), itemMasterDestination(config.destination.table)]);
  validateStagingSchema({ ...config, module }, sourceColumns, columns);
  const key = columns.find(column => column.name === config.destination.key);
  if (!key || key.readOnly || !key.supported || key.type === "bit") throw new MappingError("Choose a writable text or numeric staging matching key.");
  return { config, module, columns, lookups, table: destination.sql };
}
const eligible = (config: ItemMasterMappingConfig, rows: Array<Record<string, unknown>>) => rows.filter(row => config.source.filters.every(filter =>
  filter.value === null ? row[filter.column] === null : normalizedKey(row[filter.column]) === normalizedKey(filter.value)));
export async function previewItemMasterMapping(input: unknown) {
  const { config, columns, lookups } = await prepareItemMasterMapping(input);
  const { rows } = await readItemMasterRows(config);
  const sample = eligible(config, rows).slice(0, 5);
  return {
    valid: true, sampleCount: sample.length,
    message: sample.length ? "Item Master source reader and staging schema checked. Preview does not write to staging." : "Schema checked. No Item Master rows match the source reader and configured filters.",
    rows: sample.map(row => {
      try {
        const create = buildStagingPayload(config, row, columns, lookups, "create"), update = buildStagingPayload(config, row, columns, lookups, "update");
        return { key: row[config.source.key], source: row, create, update };
      } catch (error) { return { key: row[config.source.key], source: row, error: error instanceof Error ? error.message : String(error) }; }
    }),
  };
}
const running = new Set<string>();
const comparable = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
export async function executeItemMasterMapping(moduleId: string, codes?: string[]) {
  const saved = await itemMasterMappingStore.savedMapping(moduleId);
  if (!saved?.enabled) throw new MappingError("Save and enable this Item Master mapping before running it.");
  const module = itemMasterModule(saved.config.syncModule ?? "item-group");
  const lock = normalizedKey(saved.config.destination.table);
  if (running.has(lock)) throw new MappingError("Another configured sync is running for this staging table.", 409);
  running.add(lock);
  try {
    const { config, columns, lookups, table } = await prepareItemMasterMapping(saved.config);
    const source = await readItemMasterRows(config, codes);
    const rows = eligible(config, source.rows), keys = new Set<string>(), sourceKeys = new Set<string>();
    const prepared = rows.map(row => {
      const sourceKey = normalizedKey(row[config.source.key]);
      if (!sourceKey || sourceKeys.has(sourceKey)) throw new MappingError("Duplicate or empty Item Master source key. No staging records were written.");
      sourceKeys.add(sourceKey);
      const create = buildStagingPayload(config, row, columns, lookups, "create"), update = buildStagingPayload(config, row, columns, lookups, "update");
      const key = normalizedKey(create[config.destination.key]);
      if (keys.has(key) || key !== normalizedKey(update[config.destination.key])) throw new MappingError("Duplicate or inconsistent staging matching keys. No staging records were written.");
      keys.add(key);
      return { code: String(row[config.source.key]), key, create, update };
    });
    const keyColumn = Prisma.raw(identifier(config.destination.key));
    const existingKeys = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT ${keyColumn} FROM ${table}`;
    const existing = new Set<string>();
    for (const row of existingKeys) {
      const key = normalizedKey(row[config.destination.key]);
      if (key && existing.has(key)) throw new MappingError("Duplicate normalized staging keys. Resolve duplicates before syncing.");
      if (key) existing.add(key);
    }
    const runId = randomUUID(), startedAt = new Date();
    const transactionCode = `IM2SDB_ITEMGROUP${codes ? "_SELECTED" : ""}`;
    const transaction = await prisma.transactionType.upsert({ where: { code: transactionCode }, update: {}, create: { code: transactionCode, isActive: true } });
    const audit = await prisma.auditLog.create({ data: { ...auditActorData(), transactionTypeId: transaction.id, runId, startedAt, status: "RUNNING", totalRecords: prepared.length } });
    let inserted = 0, updated = 0, skipped = 0, failed = 0;
    const items: Array<Record<string, unknown>> = [];
    try {
      await prisma.auditLogDetail.create({ data: { auditLogId: audit.id, level: "INFO", step: "MAPPING", message: `Item Master mapping ${config.module} (${module}) version ${saved.version}; ${config.source.table} → ${config.destination.table}` } });
      for (const row of prepared) {
        let action = existing.has(row.key) ? "UPDATE" : "INSERT", errorMessage: string | undefined;
        let changes: Array<{ field: string; from: unknown; to: unknown }> = [];
        try {
          const result = await prisma.$transaction(async tx => {
            const selected = Prisma.join([...new Set([config.destination.key, ...Object.keys(row.update)])].map(name => Prisma.raw(identifier(name))));
            const current = await tx.$queryRaw<Array<Record<string, unknown>>>`
              SELECT ${selected} FROM ${table} WITH (UPDLOCK, HOLDLOCK)
              WHERE UPPER(LTRIM(RTRIM(CONVERT(NVARCHAR(450), ${keyColumn})))) = ${row.key}`;
            if (current.length > 1) throw new MappingError("Staging matching key is duplicated.");
            if (!current[0]) {
              const payload = row.create;
              await tx.$executeRaw`INSERT INTO ${table} (${Prisma.join(Object.keys(payload).map(name => Prisma.raw(identifier(name))))})
                VALUES (${Prisma.join(Object.values(payload).map(value => Prisma.sql`${value}`))})`;
              return { action: "INSERT", changes: [] };
            }
            const changes = Object.entries(row.update).filter(([name, value]) => name !== config.destination.key &&
              comparable(current[0]![name]) !== comparable(value))
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
        const names: Record<string, string> = { Initials: "initials", Name: "name", ItemClassCode: "itemClassCode", ItemClass: "itemClass", Category: "category", IsActive: "isActive" };
        changes = changes.map(change => ({ ...change, field: names[change.field] ?? change.field }));
        items.push({ code: row.code, itemGroupId: row.code, action, status, changes, ...(errorMessage ? { error: errorMessage } : {}) });
        await prisma.auditTransactionItem.create({ data: { auditLogId: audit.id, entity: "ItemGroup", referenceKey: row.code.slice(0, 100), action, status, errorMessage: errorMessage?.slice(0, 1000), payload: JSON.stringify({ mappingId: config.module, mappingVersion: saved.version, changes, ...(action === "INSERT" && !errorMessage ? { values: row.create } : {}) }) } });
      }
      const status = failed ? inserted + updated + skipped ? "PARTIAL" : "FAILED" : "SUCCESS";
      const endedAt = new Date();
      await prisma.auditLog.update({ where: { id: audit.id }, data: { status, endedAt, insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed } });
      const matched = new Set(rows.map(row => normalizedKey(row[config.source.key])));
      const missingCodes = source.requestedCodes?.filter(code => !matched.has(code)) ?? [];
      return {
        runId, source: "itemmaster-staging", entity: module, module: "itemmaster-staging", mappingId: saved.config.module, mappingVersion: saved.version, status,
        startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), totalRecords: prepared.length, totalRows: prepared.length,
        inserted, updated, skipped, failed, insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed,
        processedCount: inserted + updated, successCount: inserted + updated + skipped, items, data: items,
        failedRows: items.filter(item => item.status === "FAILED"), requestedCodes: source.requestedCodes, foundCodes: prepared.map(row => row.code), missingCodes,
        missingDetails: missingCodes.map(code => ({ code, status: "NOT_FOUND", reason: "Not found in the Item Master source reader or excluded by mapping filters" })),
      };
    } catch (error) {
      await prisma.auditLog.update({ where: { id: audit.id }, data: { status: "FAILED", endedAt: new Date(), errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 1000), insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed } });
      throw error;
    }
  } finally { running.delete(lock); }
}
