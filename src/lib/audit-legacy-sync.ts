import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { auditActorData } from "./audit-context";

export async function auditLegacySync<T extends object>(entity: string, run: () => Promise<T>, selected = false): Promise<T & { runId: string }> {
  const runId = randomUUID(), startedAt = new Date();
  const code = `SDB2SP_${entity.replace(/-/g, "").toUpperCase()}${selected ? "_SELECTED" : ""}`;
  const type = await prisma.transactionType.upsert({ where: { code }, update: {}, create: { code, isActive: true } });
  const audit = await prisma.auditLog.create({ data: { ...auditActorData(), transactionTypeId: type.id, runId, startedAt, status: "RUNNING" } });
  let operationReturned = false;
  try {
    const value = await run();
    operationReturned = true;
    const result = value as Record<string, unknown>;
    const inserted = Number(result.inserted ?? result.insertedCount ?? result.createdCount ?? 0);
    const updated = Number(result.updated ?? result.updatedCount ?? 0), skipped = Number(result.skipped ?? result.skippedCount ?? 0);
    const failed = Number(result.failed ?? result.failedCount ?? 0);
    const status = failed ? inserted + updated + skipped ? "PARTIAL" : "FAILED" : "SUCCESS";
    await prisma.auditLog.update({ where: { id: audit.id }, data: { totalRecords: Number(result.totalRecords ?? result.totalItems ?? result.totalRows ?? 0), insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed } });
    const items = (Array.isArray(result.items) ? result.items : Array.isArray(result.failedItems) ? result.failedItems : []) as Array<Record<string, unknown>>;
    // Audit writes are batched, rather than issuing a database request for each result.
    for (let start = 0; start < items.length; start += 100) {
      await prisma.auditTransactionItem.createMany({ data: items.slice(start, start + 100).map(item => ({
        auditLogId: audit.id, entity, referenceKey: String(item.code ?? item.whCode ?? item.itmsGrpCod ?? item.itemGroupId ?? item.itemCode ?? item.uomCode ?? "Unknown").slice(0, 100),
        action: String(item.action ?? (item.error ? "UPSERT" : "UNKNOWN")).slice(0, 20),
        status: String(item.status ?? (item.error ? "FAILED" : "UNKNOWN")).slice(0, 20),
        errorMessage: item.error ? String(item.error).slice(0, 1000) : null,
        payload: JSON.stringify({ changes: item.changes, reason: item.reason }),
      })) });
    }
    const endedAt = new Date();
    await prisma.auditLog.update({ where: { id: audit.id }, data: { status, endedAt, totalRecords: Number(result.totalRecords ?? result.totalItems ?? result.totalRows ?? items.length), insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed } });
    return { ...value, runId, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), status };
  } catch (error) {
    await prisma.auditLog.update({ where: { id: audit.id }, data: { status: "FAILED", endedAt: new Date(), errorMessage: `${operationReturned ? 'The sync operation returned, but audit recording failed: ' : ''}${error instanceof Error ? error.message : String(error)}`.slice(0, 1000) } });
    throw error;
  }
}
