import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { cachedDataRead } from "../../lib/data-read-cache";

export class AuditInputError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function integer(value: unknown, fallback: number, max = 100000) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw new AuditInputError(`Use a positive integer up to ${max}.`);
  return Number(value);
}
const text = (value: unknown) => {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 150) throw new AuditInputError("Invalid search/filter value.");
  return value.trim() || undefined;
};
export function localDate(value: unknown, end = false) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AuditInputError("Use a date in YYYY-MM-DD format.");
  const utc = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) throw new AuditInputError("Invalid calendar date.");
  return new Date(utc.getTime() - 8 * 3600000 + (end ? 86400000 : 0));
}
const statuses = new Set(["SUCCESS", "PARTIAL", "FAILED", "RUNNING"]);
const actions = new Set(["INSERT", "UPDATE", "SKIP", "UPSERT", "UNKNOWN"]);
function statusFilter(value: unknown, allowed: Set<string>) {
  const candidate = text(value);
  if (candidate && !allowed.has(candidate)) throw new AuditInputError("Unsupported status/action filter.");
  return candidate;
}
export function auditWhere(query: Record<string, unknown>): Prisma.AuditLogWhereInput {
  const from = localDate(query.from), to = localDate(query.to, true), search = text(query.search);
  if (from && to && from >= to) throw new AuditInputError("The start date must not be after the end date.");
  return {
    ...(from || to ? { startedAt: { gte: from, lt: to } } : {}), status: query.status === "ATTENTION" ? { in: ["FAILED", "PARTIAL"] } : statusFilter(query.status, statuses),
    ...(query.type !== undefined && query.type !== "" ? { transactionTypeId: integer(query.type, 1) } : {}),
    ...(search ? { OR: [
      { transactionType: { code: { contains: search } } }, { items: { some: { referenceKey: { contains: search } } } },
      { details: { some: { step: "ACTOR", message: { contains: search } } } },
      ...(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(search) ? [{ runId: search }] : []),
    ] } : {}),
  };
}
export function describeTransaction(code: string) {
  let flow = "Other", key = code;
  if (code.startsWith("SAP2SDB_")) { flow = "SAP → Staging"; key = code.slice(8); }
  else if (code.startsWith("IM2SDB_")) { flow = "Item Master → Staging"; key = code.slice(7); }
  else if (code.startsWith("SDB2SP_")) { flow = "Staging → SharePoint"; key = code.slice(7); }
  else if (code.startsWith("MAPPING_SP_")) { flow = "Staging → SharePoint"; key = code.slice(11); }
  key = key.replace(/_SELECTED$/, "");
  const normalized = key.replace(/[-_]/g, "");
  const modules: Record<string, { label: string; path: string }> = { WAREHOUSE: { label: "Warehouses", path: "warehouses" }, ITEMCLASS: { label: "Item Class", path: "item-class" }, ITEMGROUP: { label: "Item Group", path: "item-group" }, UOM: { label: "UOM", path: "uom" }, ITEM: { label: "Items", path: "items" }, ITEMS: { label: "Items", path: "items" } };
  return { flow, module: modules[normalized]?.label ?? key.toLowerCase().replace(/[-_]/g, " "), modulePath: modules[normalized]?.path ?? null, selected: code.endsWith("_SELECTED") };
}
function parseJson(value: string | null) { if (!value) return null; try { return JSON.parse(value) as unknown; } catch { return value; } }
export function recordedActor(details: Array<{ step: string; message: string }>) {
  const value = parseJson(details.find(detail => detail.step === "ACTOR")?.message ?? null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const actor = value as Record<string, unknown>;
  return typeof actor.name === "string" && typeof actor.email === "string" ? { userId: typeof actor.userId === "number" ? actor.userId : null, name: actor.name, email: actor.email } : null;
}
const runInclude = { transactionType: { select: { code: true } }, details: { where: { step: "ACTOR" }, take: 1, orderBy: { id: "asc" as const } }, _count: { select: { items: true } } } satisfies Prisma.AuditLogInclude;
type Run = Prisma.AuditLogGetPayload<{ include: typeof runInclude }>;
function serializeRun(run: Run) {
  return { id: run.id, runId: run.runId, transactionTypeId: run.transactionTypeId, transactionCode: run.transactionType.code,
    ...describeTransaction(run.transactionType.code), status: run.status, startedAt: run.startedAt, endedAt: run.endedAt,
    durationMs: run.endedAt ? Math.max(0, run.endedAt.getTime() - run.startedAt.getTime()) : null,
    totalRecords: run.totalRecords, inserted: run.insertedCount, updated: run.updatedCount, skipped: run.skippedCount, failed: run.failedCount,
    errorMessage: run.errorMessage, recordedItems: run._count.items, actor: recordedActor(run.details) };
}
export async function listRuns(query: Record<string, unknown>) {
  const page = integer(query.page, 1), limit = integer(query.limit, 20, 100), where = auditWhere(query);
  const [runs, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: [{ startedAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit, include: runInclude }), prisma.auditLog.count({ where }),
  ]);
  return { data: runs.map(serializeRun), total, page, limit, timezone: "Asia/Manila" };
}
export async function runDetails(id: number) {
  const run = await prisma.auditLog.findUnique({ where: { id }, include: { ...runInclude, details: { orderBy: { id: "asc" } } } });
  if (!run) throw new AuditInputError("This sync run was not found.", 404);
  return { ...serializeRun(run), steps: run.details.filter(detail => detail.step !== "ACTOR") };
}
export async function runItems(id: number, query: Record<string, unknown>) {
  if (!await prisma.auditLog.findUnique({ where: { id }, select: { id: true } })) throw new AuditInputError("This sync run was not found.", 404);
  const page = integer(query.page, 1), limit = integer(query.limit, 20, 100), search = text(query.search);
  const where: Prisma.AuditTransactionItemWhereInput = { auditLogId: id, status: statusFilter(query.status, statuses), action: statusFilter(query.action, actions),
    ...(search ? { OR: [{ referenceKey: { contains: search } }, { entity: { contains: search } }] } : {}) };
  const [items, total] = await Promise.all([prisma.auditTransactionItem.findMany({ where, orderBy: { id: "asc" }, skip: (page - 1) * limit, take: limit }), prisma.auditTransactionItem.count({ where })]);
  return { data: items.map(item => ({ ...item, payload: parseJson(item.payload) })), total, page, limit };
}
export async function auditOverview(days: number) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const end = localDate(today, true)!;
  const start = new Date(end.getTime() - days * 86400000), where = { startedAt: { gte: start, lt: end } };
  return cachedDataRead(`audit-overview:${today}:${days}`, async () => {
    const [groups, daily, types, recent, running] = await Promise.all([
      prisma.auditLog.groupBy({ by: ["transactionTypeId", "status"], where, _count: { _all: true }, _sum: { totalRecords: true, insertedCount: true, updatedCount: true, skippedCount: true, failedCount: true } }),
      prisma.$queryRaw<Array<{ day: Date; status: string; runs: number }>>`SELECT CAST(DATEADD(hour, 8, StartedAt) AS date) AS [day], Status AS status, COUNT(*) AS runs FROM dbo.AuditLogs WHERE StartedAt >= ${start} AND StartedAt < ${end} GROUP BY CAST(DATEADD(hour, 8, StartedAt) AS date), Status`,
      prisma.transactionType.findMany({ select: { id: true, code: true } }),
      prisma.auditLog.findMany({ take: 8, orderBy: [{ startedAt: "desc" }, { id: "desc" }], include: runInclude }),
      prisma.auditLog.count({ where: { status: "RUNNING" } }),
    ]);
    const totals = { runs: 0, success: 0, partial: 0, failed: 0, running, inserted: 0, updated: 0, skipped: 0, failedRecords: 0, records: 0 };
    const modules = new Map<string, { module: string; runs: number; changed: number; failed: number }>();
    for (const group of groups) {
      const count = group._count._all;
      totals.runs += count;
      if (group.status === "SUCCESS") totals.success += count;
      if (group.status === "PARTIAL") totals.partial += count;
      if (group.status === "FAILED") totals.failed += count;
      totals.inserted += group._sum.insertedCount ?? 0; totals.updated += group._sum.updatedCount ?? 0;
      totals.skipped += group._sum.skippedCount ?? 0; totals.failedRecords += group._sum.failedCount ?? 0; totals.records += group._sum.totalRecords ?? 0;
      const name = describeTransaction(types.find(type => type.id === group.transactionTypeId)?.code ?? "Unknown").module;
      const module = modules.get(name) ?? { module: name, runs: 0, changed: 0, failed: 0 };
      module.runs += count; module.changed += (group._sum.insertedCount ?? 0) + (group._sum.updatedCount ?? 0); module.failed += group._sum.failedCount ?? 0;
      modules.set(name, module);
    }
    const trend = Array.from({ length: days }, (_, index) => {
      const date = new Date(start.getTime() + index * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
      const values = daily.filter(row => row.day.toISOString().slice(0, 10) === date);
      return { date, success: values.filter(row => row.status === "SUCCESS").reduce((sum, row) => sum + row.runs, 0), failed: values.filter(row => ["FAILED", "PARTIAL"].includes(row.status)).reduce((sum, row) => sum + row.runs, 0), running: values.filter(row => row.status === "RUNNING").reduce((sum, row) => sum + row.runs, 0) };
    });
    const completed = totals.success + totals.failed + totals.partial;
    return { days, from: start, to: end, timezone: "Asia/Manila", totals, successRate: completed ? Math.round(totals.success / completed * 1000) / 10 : null, trend, modules: [...modules.values()].sort((a, b) => b.runs - a.runs), recent: recent.map(serializeRun), generatedAt: new Date() };
  });
}
