import { auditActorData } from "../../lib/audit-context";
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { MappingConfig, MappingError, buildPayload, normalizedKey, parseConfig, validateSchema } from "./domain";
import { collection, destinationColumns, graph, listPath, loadLookups, readRows, sourceColumns, sourceFieldNames } from "./metadata";
import { savedMapping } from "./store";

export async function prepare(input: unknown) {
  const config = parseConfig(input);
  const [source, destination] = await Promise.all([sourceColumns(config.source.table), destinationColumns(config.destination.siteId, config.destination.listId)]);
  validateSchema(config, source, destination);
  const lookups = await loadLookups(config);
  return { config, destination, lookups };
}
export async function previewMapping(input: unknown) {
  const { config, destination, lookups } = await prepare(input);
  const rows = await readRows(config.source.table, sourceFieldNames(config), config.source.filters, 5);
  return {
    valid: true, sampleCount: rows.length,
    message: rows.length ? "Schema and sample values validated. Preview does not write to SharePoint." : "Schema validated. No source records match the filters; sample values could not be checked.",
    rows: rows.map(row => {
      try { return { key: row[config.source.key], source: row, create: buildPayload(config, row, destination, lookups, "create"), update: buildPayload(config, row, destination, lookups, "update") }; }
      catch (error) { return { key: row[config.source.key], source: row, error: (error as Error).message }; }
    }),
  };
}
type SharePointItem = { id: string; eTag?: string; fields?: Record<string, unknown> };
const runningTargets = new Set<string>();
export async function executeMapping(module: string, codes?: string[]) {
  const saved = await savedMapping(module);
  if (!saved?.enabled) throw new MappingError("Enable and save this mapping before running it.");
  const target = JSON.stringify([saved.config.destination.siteId, saved.config.destination.listId]);
  if (runningTargets.has(target)) throw new MappingError("Another configured sync is already running for this SharePoint list. Wait for it to finish.", 409);
  runningTargets.add(target);
  try { return await runMapping(saved, codes); }
  finally { runningTargets.delete(target); }
}
async function runMapping(saved: NonNullable<Awaited<ReturnType<typeof savedMapping>>>, codes?: string[]) {
  const module = saved.module;
  const { config, destination, lookups } = await prepare(saved.config);
  let rows = await readRows(config.source.table, sourceFieldNames(config), config.source.filters);
  const requestedCodes = codes ? [...new Set(codes.map(normalizedKey))] : undefined;
  if (requestedCodes) rows = rows.filter(row => requestedCodes.includes(normalizedKey(row[config.source.key])));
  const foundCodes = rows.map(row => String(row[config.source.key]));
  const found = new Set(foundCodes.map(normalizedKey));
  const missingCodes = requestedCodes?.filter(code => !found.has(code)) ?? [];
  const seen = new Set<string>();
  const sourceKeys = new Set<string>();
  // Preflight every row before writing anything, including lookup and type validation.
  const prepared = rows.map(row => {
    const sourceKey = normalizedKey(row[config.source.key]);
    if (!sourceKey || sourceKeys.has(sourceKey)) throw new MappingError(`Source record key ${sourceKey || '(empty)'} is empty or duplicated. No records were written.`);
    sourceKeys.add(sourceKey);
    const create = buildPayload(config, row, destination, lookups, "create");
    const update = buildPayload(config, row, destination, lookups, "update");
    const key = normalizedKey(create[config.destination.key]);
    if (seen.has(key)) throw new MappingError(`Duplicate source matching key ${key}. No records were written.`);
    seen.add(key);
    return { code: String(row[config.source.key]), key, create, update };
  });
  const path = listPath(config.destination.siteId, config.destination.listId);
  const existing = new Map<string, SharePointItem>();
  if (prepared.length) {
    const items = await collection<SharePointItem>(`${path}/items?$expand=fields&$top=200`);
    for (const item of items) {
      const key = normalizedKey(item.fields?.[config.destination.key]);
      if (!key) continue;
      if (existing.has(key)) throw new MappingError(`Duplicate SharePoint matching key ${key}. Resolve duplicates before syncing.`);
      existing.set(key, item);
    }
  }
  const runId = randomUUID();
  const startedAt = new Date();
  const transactionCode = `MAPPING_SP_${module.toUpperCase()}${codes ? '_SELECTED' : ''}`;
  const transaction = await prisma.transactionType.upsert({
    where: { code: transactionCode }, update: {},
    create: { code: transactionCode, isActive: true },
  });
  const audit = await prisma.auditLog.create({ data: { ...auditActorData(), transactionTypeId: transaction.id, runId, startedAt, status: "RUNNING", totalRecords: prepared.length } });
  await prisma.auditLogDetail.create({ data: { auditLogId: audit.id, level: "INFO", step: "MAPPING", message: `SharePoint mapping ${module} version ${saved.version}; ${config.source.table}; ${config.destination.listId}` } });
  let inserted = 0, updated = 0, skipped = 0, failed = 0;
  const items: Array<Record<string, unknown>> = [];
  try {
    for (const row of prepared) {
      const current = existing.get(row.key);
      let action = current ? "UPDATE" : "INSERT";
      let errorMessage: string | undefined;
      const changes = current ? Object.entries(row.update).filter(([field, value]) => {
        const old = current.fields?.[field];
        return value == null ? old != null && old !== "" : String(old ?? "") !== String(value);
      }).map(([field, to]) => ({ field, from: current.fields?.[field] ?? null, to })) : [];
      try {
        if (!current) {
          await graph(`${path}/items`, { method: "POST", body: JSON.stringify({ fields: row.create }) });
          inserted++;
        } else {
          const changed = changes.length > 0;
          if (!changed) { action = "SKIP"; skipped++; }
          else {
            await graph(`${path}/items/${encodeURIComponent(current.id)}/fields`, {
              method: "PATCH", headers: current.eTag ? { "If-Match": current.eTag } : {}, body: JSON.stringify(row.update),
            });
            updated++;
          }
        }
      } catch (error) { errorMessage = (error as Error).message; failed++; }
      const status = errorMessage ? "FAILED" : "SUCCESS";
      items.push({ code: row.code, action, status, ...(errorMessage ? { error: errorMessage } : {}) });
      await prisma.auditTransactionItem.create({ data: { auditLogId: audit.id, entity: module, referenceKey: row.code.slice(0, 100), action, status, errorMessage: errorMessage?.slice(0, 1000), payload: JSON.stringify({ mappingId: config.module, mappingVersion: saved.version, changes: errorMessage ? [] : changes, ...(action === "INSERT" && !errorMessage ? { values: row.create } : {}) }) } });
    }
    const status = failed ? inserted + updated + skipped ? "PARTIAL" : "FAILED" : "SUCCESS";
    const endedAt = new Date();
    await prisma.auditLog.update({ where: { id: audit.id }, data: { status, endedAt, insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed } });
    return {
      runId, module, mappingVersion: saved.version, status, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(),
      totalRecords: prepared.length, totalItems: prepared.length, inserted, updated, skipped, failed,
      createdCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed,
      failedItems: items.filter(i => i.status === "FAILED"), items, requestedCodes, foundCodes, missingCodes,
      missingDetails: missingCodes.map(code => ({ code, status: "NOT_FOUND", reason: "Not found in the configured source, or excluded by its filters" })),
    };
  } catch (error) {
    await prisma.auditLog.update({ where: { id: audit.id }, data: { status: "FAILED", endedAt: new Date(), errorMessage: (error as Error).message.slice(0, 1000), insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed } });
    throw error;
  }
}
