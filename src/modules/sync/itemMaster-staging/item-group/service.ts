import { auditActorData } from "../../../../lib/audit-context";
import { randomUUID } from "crypto";
import { getItemMasterPool } from "../../../../lib/itemMaster";
import { prisma } from "../../../../lib/prisma";

type ItemMasterItemGroupRow = {
  ItemGroupID: string;
  Initials: string;
  Name: string;
  ItemClassCode: string | null;
  ItemClass: string | null;
  Category: string;
};

type ItemGroupSyncItemResult = {
  itemGroupId: string;
  action: "INSERT" | "UPDATE" | "SKIP";
  status: "SUCCESS" | "FAILED";
  reason?: string;
  error?: string;
  changes?: Array<{
    field: "initials" | "name" | "itemClassCode" | "itemClass" | "category" | "isActive";
    from: string | boolean | null;
    to: string | boolean | null;
  }>;
};

const TRANSACTION_CODE = "IM2SDB_ITEMGROUP";
const TRANSACTION_CODE_SELECTED = "IM2SDB_ITEMGROUP_SELECTED";

const getIncomingValues = (row: ItemMasterItemGroupRow) => ({
  initials: row.Initials,
  name: row.Name,
  itemClassCode: row.ItemClassCode ?? "",
  itemClass: row.ItemClass ?? "",
  category: row.Category,
  isActive: true,
});

const getChanges = (
  existing: {
    initials: string;
    name: string;
    itemClassCode: string;
    itemClass: string;
    category: string;
    isActive: boolean;
  },
  incoming: {
    initials: string;
    name: string;
    itemClassCode: string;
    itemClass: string;
    category: string;
    isActive: boolean;
  },
) => {
  const changes: Array<{
    field: "initials" | "name" | "itemClassCode" | "itemClass" | "category" | "isActive";
    from: string | boolean | null;
    to: string | boolean | null;
  }> = [];

  if (existing.initials !== incoming.initials) {
    changes.push({ field: "initials", from: existing.initials, to: incoming.initials });
  }

  if (existing.name !== incoming.name) {
    changes.push({ field: "name", from: existing.name, to: incoming.name });
  }

  if (existing.itemClassCode !== incoming.itemClassCode) {
    changes.push({ field: "itemClassCode", from: existing.itemClassCode, to: incoming.itemClassCode });
  }

  if (existing.itemClass !== incoming.itemClass) {
    changes.push({ field: "itemClass", from: existing.itemClass, to: incoming.itemClass });
  }

  if (existing.category !== incoming.category) {
    changes.push({ field: "category", from: existing.category, to: incoming.category });
  }

  if (existing.isActive !== incoming.isActive) {
    changes.push({ field: "isActive", from: existing.isActive, to: incoming.isActive });
  }

  return changes;
};

const createAuditLog = async (transactionCode: string) => {
  const runId = randomUUID();
  const startedAt = new Date();

  const txType = await prisma.transactionType.upsert({
    where: { code: transactionCode },
    update: {},
    create: { code: transactionCode, isActive: true },
  });

  const auditLog = await prisma.auditLog.create({
    data: { ...auditActorData(),
      transactionTypeId: txType.id,
      runId,
      status: "RUNNING",
      startedAt,
      totalRecords: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    },
  });

  return { runId, startedAt, auditLog };
};

const normalizeCodes = (codes: string[]) => {
  return [...new Set(codes.map((c: string) => c.trim().toUpperCase()).filter((c: string) => c.length > 0))];
};

export const fetchItemMasterRows = async () => {
  const pool = await getItemMasterPool();

  const result = await pool.request().query<ItemMasterItemGroupRow>(`
    SELECT
      IG.code AS ItemGroupID,
      UPPER(IG.initials) AS Initials,
      UPPER(IG.name) AS Name,
      UPPER(IC.initials) AS ItemClassCode,
      UPPER(IC.name) AS ItemClass,
      UPPER(IG.category) AS Category
    FROM item_groups IG
    LEFT JOIN item_classes IC
      ON IG.item_class_code = IC.code
    WHERE IG.initials IS NOT NULL
    ORDER BY IG.code
  `);

  return result.recordset;
};

const fetchItemMasterRowsByCodes = async (codes: string[]) => {
  const normalizedCodes = normalizeCodes(codes);

  if (normalizedCodes.length === 0) {
    return { requestedCodes: [], foundRows: [] as ItemMasterItemGroupRow[], missingCodes: [] as string[] };
  }

  const pool = await getItemMasterPool();
  const request = pool.request();

  const placeholders = normalizedCodes.map((code: string, index: number) => {
    const paramName = `code${index}`;
    request.input(paramName, code);
    return `@${paramName}`;
  });

  const result = await request.query<ItemMasterItemGroupRow>(`
    SELECT
      IG.code AS ItemGroupID,
      UPPER(IG.initials) AS Initials,
      UPPER(IG.name) AS Name,
      UPPER(IC.initials) AS ItemClassCode,
      UPPER(IC.name) AS ItemClass,
      UPPER(IG.category) AS Category
    FROM item_groups IG
    LEFT JOIN item_classes IC
      ON IG.item_class_code = IC.code
    WHERE UPPER(IG.code) IN (${placeholders.join(", ")})
      AND IG.initials IS NOT NULL
    ORDER BY IG.code
  `);

  const foundCodes = new Set(result.recordset.map((row: ItemMasterItemGroupRow) => String(row.ItemGroupID).toUpperCase()));
  const missingCodes = normalizedCodes.filter((code: string) => !foundCodes.has(code));

  return { requestedCodes: normalizedCodes, foundRows: result.recordset, missingCodes };
};

const syncItemGroupRows = async ({
  sourceRows,
  transactionCode,
  fetchMessage,
}: {
  sourceRows: ItemMasterItemGroupRow[];
  transactionCode: string;
  fetchMessage: string;
}) => {
  const { runId, startedAt, auditLog } = await createAuditLog(transactionCode);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items: ItemGroupSyncItemResult[] = [];

  try {
    const totalRecords = sourceRows.length;

    await prisma.auditLog.update({ where: { id: auditLog.id }, data: { totalRecords } });

    await prisma.auditLogDetail.create({
      data: { auditLogId: auditLog.id, level: "INFO", step: "FETCH", message: fetchMessage },
    });

    for (const row of sourceRows) {
      try {
        const itemGroupId = String(row.ItemGroupID);
        const incoming = getIncomingValues(row);
        const existing = await prisma.itemGroup.findUnique({ where: { itemGroupId } });

        if (existing) {
          const changes = getChanges(existing, incoming);

          if (changes.length === 0) {
            skipped++;
            items.push({ itemGroupId, action: "SKIP", status: "SUCCESS", reason: "Already up-to-date in staging" });
            await prisma.auditTransactionItem.create({
              data: { auditLogId: auditLog.id, entity: "ItemGroup", referenceKey: itemGroupId, action: "SKIP", status: "SUCCESS" },
            });
            continue;
          }

          await prisma.itemGroup.update({
            where: { itemGroupId },
            data: { ...incoming, updatedAt: new Date() },
          });

          updated++;
          items.push({ itemGroupId, action: "UPDATE", status: "SUCCESS", changes });
          await prisma.auditTransactionItem.create({
            data: { auditLogId: auditLog.id, entity: "ItemGroup", referenceKey: itemGroupId, action: "UPDATE", status: "SUCCESS", payload: JSON.stringify({ changes }) },
          });
        } else {
          await prisma.itemGroup.create({ data: { itemGroupId, ...incoming } });
          inserted++;
          items.push({ itemGroupId, action: "INSERT", status: "SUCCESS" });
          await prisma.auditTransactionItem.create({
            data: { auditLogId: auditLog.id, entity: "ItemGroup", referenceKey: itemGroupId, action: "INSERT", status: "SUCCESS" },
          });
        }
      } catch (itemErr) {
        const itemGroupId = String(row.ItemGroupID);
        const existing = await prisma.itemGroup.findUnique({ where: { itemGroupId } });
        const action = existing ? "UPDATE" : "INSERT";
        const errorMessage = (itemErr as Error).message;
        failed++;
        items.push({ itemGroupId, action, status: "FAILED", error: errorMessage });
        await prisma.auditTransactionItem.create({
          data: { auditLogId: auditLog.id, entity: "ItemGroup", referenceKey: itemGroupId, action, status: "FAILED", errorMessage },
        });
      }
    }

    const finalStatus = failed > 0 && inserted + updated + skipped > 0 ? "PARTIAL" : failed > 0 ? "FAILED" : "SUCCESS";

    await prisma.auditLog.update({
      where: { id: auditLog.id },
      data: { status: finalStatus, endedAt: new Date(), insertedCount: inserted, updatedCount: updated, skippedCount: skipped, failedCount: failed },
    });

    await prisma.auditLogDetail.create({
      data: {
        auditLogId: auditLog.id,
        level: "INFO",
        step: "COMPLETE",
        message: `Sync complete — inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}, failed: ${failed}`,
      },
    });

    return {
      module: "itemmaster-staging",
      entity: "item-group",
      runId,
      status: finalStatus,
      totalRecords: sourceRows.length,
      inserted,
      updated,
      skipped,
      failed,
      items,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
    };
  } catch (err) {
    await prisma.auditLog.update({
      where: { id: auditLog.id },
      data: { status: "FAILED", endedAt: new Date(), errorMessage: (err as Error).message },
    });

    throw err;
  }
};

export const runItemGroupSync = async () => {
  const sourceRows = await fetchItemMasterRows();

  return syncItemGroupRows({
    sourceRows,
    transactionCode: TRANSACTION_CODE,
    fetchMessage: `Fetched ${sourceRows.length} item groups from Item Master`,
  });
};

export const runItemGroupSyncByCodes = async (codes: string[]) => {
  const { requestedCodes, foundRows, missingCodes } = await fetchItemMasterRowsByCodes(codes);

  const syncResult = await syncItemGroupRows({
    sourceRows: foundRows,
    transactionCode: TRANSACTION_CODE_SELECTED,
    fetchMessage: `Fetched ${foundRows.length} item groups from Item Master for selected codes`,
  });

  return {
    ...syncResult,
    requestedCodes,
    foundCodes: foundRows.map((row) => String(row.ItemGroupID)),
    missingCodes,
    missingDetails: missingCodes.map((code: string) => ({
      code,
      status: "NOT_FOUND",
      reason: "Item group code not found in Item Master (item_groups)",
    })),
  };
};
