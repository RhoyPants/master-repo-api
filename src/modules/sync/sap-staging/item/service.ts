import { randomUUID } from "crypto";
import { getSapPool } from "../../../../lib/sap";
import { prisma } from "../../../../lib/prisma";

interface SAPItemRow {
  ItemCode: string;
  ItemDescription: string;
  validFor: string;
  Category: string;
  itemClassCode: string | null;
  itemClassName: string | null;
  UOM: string | null;
  UOM_ID: number | null;
  LeadTime: number | null;
  iswhInventory: number;
  isSalesInventory: number;
  isPurchaseInventory: number;
  ItemGroupName: string | null;
}

interface SyncResult {
  source: "sap-staging";
  entity: "item";
  runId: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  startedAt: string;
  endedAt?: string;
  totalRows: number;
  processedCount: number;
  successCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  failedRows: Array<{ code: string; error: string }>;
  data: Array<{
    code: string;
    action: "INSERT" | "UPDATE" | "SKIP" | "UPSERT";
    status: "SUCCESS" | "FAILED";
    reason?: string;
    error?: string;
  }>;
}

const TRANSACTION_CODE = "SAP2SDB_ITEM";
const TRANSACTION_CODE_SELECTED = "SAP2SDB_ITEM_SELECTED";

/* ===================== FETCH FUNCTIONS ===================== */

async function fetchSAPItemsFromOITM(): Promise<SAPItemRow[]> {
  const pool = await getSapPool();

  const query = `
    SELECT
      UPPER(itm.ItemCode)        AS ItemCode,
      UPPER(itm.ItemName)        AS ItemDescription,
      itm.validFor               AS validFor,
      UPPER(itm.ItemType)        AS Category,
      grp.U_Initials             AS itemClassCode,
      UPPER(grp.ItmsGrpNam)      AS itemClassName,
      UPPER(uom.UomCode)         AS UOM,
      uom.UomEntry               AS UOM_ID,
      itm.LeadTime               AS LeadTime,
      itm.ByWh                   AS iswhInventory,
      itm.SellItem               AS isSalesInventory,
      itm.PrchseItem             AS isPurchaseInventory,
      UPPER(itm.U_ItemClass)     AS ItemGroupName
    FROM OITM itm
    LEFT JOIN OITB grp
      ON itm.ItmsGrpCod = grp.ItmsGrpCod
    LEFT JOIN OUOM uom
      ON itm.InvntryUom = uom.UomName OR itm.InvntryUom = uom.UomCode
    WHERE itm.validFor = 'Y' AND itm.CreateDate >= '2026-04-22 00:00:00.000'
    ORDER BY itm.ItemCode
  `;

  const result = await pool.request().query<SAPItemRow>(query);
  return result.recordset;
}

function normalizeItemCodes(codes: string[]): string[] {
  return [...new Set(codes.map((c) => String(c ?? "").trim().toUpperCase()))].filter((c) => c.length > 0);
}

async function fetchSAPItemsByCodes(codes: string[]): Promise<{ requestedCodes: string[]; foundRows: SAPItemRow[]; missingCodes: string[] }> {
  const requestedCodes = normalizeItemCodes(codes);

  if (requestedCodes.length === 0) {
    return { requestedCodes: [], foundRows: [], missingCodes: [] };
  }

  const pool = await getSapPool();

  const placeholders = requestedCodes.map((_, i) => `@code${i}`).join(",");
  const query = `
    SELECT
      UPPER(itm.ItemCode)        AS ItemCode,
      UPPER(itm.ItemName)        AS ItemDescription,
      itm.validFor               AS validFor,
      UPPER(itm.ItemType)        AS Category,
      grp.U_Initials             AS itemClassCode,
      UPPER(grp.ItmsGrpNam)      AS itemClassName,
      UPPER(uom.UomCode)         AS UOM,
      uom.UomEntry               AS UOM_ID,
      itm.LeadTime               AS LeadTime,
      itm.ByWh                   AS iswhInventory,
      itm.SellItem               AS isSalesInventory,
      itm.PrchseItem             AS isPurchaseInventory,
      UPPER(itm.U_ItemClass)     AS ItemGroupName
    FROM OITM itm
    LEFT JOIN OITB grp
      ON itm.ItmsGrpCod = grp.ItmsGrpCod
    LEFT JOIN OUOM uom
      ON itm.InvntryUom = uom.UomName OR itm.InvntryUom = uom.UomCode
    WHERE UPPER(itm.ItemCode) IN (${placeholders}) AND itm.validFor = 'Y' AND itm.CreateDate >= '2026-04-22 00:00:00.000'
    ORDER BY itm.ItemCode
  `;

  const request = pool.request();
  requestedCodes.forEach((code, i) => {
    request.input(`code${i}`, code);
  });

  const result = await request.query<SAPItemRow>(query);
  const foundRows = result.recordset;

  const foundCodes = foundRows.map((row: SAPItemRow) => row.ItemCode.toUpperCase());
  const missingCodes = requestedCodes.filter((code: string) => !foundCodes.includes(code.toUpperCase()));

  return { requestedCodes, foundRows, missingCodes };
}

/* ===================== SYNC HELPER ===================== */

async function syncItemRows(options: { sourceRows: SAPItemRow[]; transactionCode: string; fetchMessage: string }): Promise<SyncResult> {
  const { sourceRows, transactionCode, fetchMessage } = options;

  const runId = randomUUID();
  const startedAt = new Date();

  const syncResult: SyncResult = {
    source: "sap-staging",
    entity: "item",
    runId,
    status: "RUNNING",
    startedAt: startedAt.toISOString(),
    totalRows: sourceRows.length,
    processedCount: 0,
    successCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failedRows: [],
    data: [],
  };

  if (sourceRows.length === 0) {
    syncResult.status = "SUCCESS";
    syncResult.processedCount = 0;
    syncResult.successCount = 0;
    syncResult.skippedCount = 0;
    syncResult.endedAt = new Date().toISOString();
    return syncResult;
  }

  const txType = await prisma.transactionType.upsert({
    where: { code: transactionCode },
    update: {},
    create: { code: transactionCode, isActive: true },
  });

  const auditLog = await prisma.auditLog.create({
    data: {
      transactionTypeId: txType.id,
      runId,
      status: "RUNNING",
      startedAt,
      totalRecords: sourceRows.length,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    },
  });

  await prisma.auditLogDetail.create({
    data: {
      auditLogId: auditLog.id,
      level: "INFO",
      step: "FETCH",
      message: `${fetchMessage} Total rows to sync: ${sourceRows.length}`,
    },
  });

  const stagingItemClasses = await prisma.itemClass.findMany({
    select: { itmsGrpCod: true, initials: true },
  });

  const stagingUoms = await prisma.uom.findMany({
    select: { id: true, uomCode: true },
  });

  const itemClassCodeSet = new Set(stagingItemClasses.map((row) => row.itmsGrpCod.toUpperCase()));
  const itemClassInitialsToCode = new Map<string, string>();
  const ambiguousItemClassInitials = new Set<string>();

  for (const itemClass of stagingItemClasses) {
    const initials = String(itemClass.initials ?? "").trim().toUpperCase();
    const itmsGrpCod = String(itemClass.itmsGrpCod ?? "").trim().toUpperCase();

    if (!initials || !itmsGrpCod) continue;

    const existingCode = itemClassInitialsToCode.get(initials);
    if (existingCode && existingCode !== itmsGrpCod) {
      ambiguousItemClassInitials.add(initials);
      itemClassInitialsToCode.delete(initials);
      continue;
    }

    if (!ambiguousItemClassInitials.has(initials)) {
      itemClassInitialsToCode.set(initials, itmsGrpCod);
    }
  }

  const uomCodeToId = new Map(stagingUoms.map((row) => [row.uomCode.toUpperCase(), row.id]));

  for (const row of sourceRows) {
    try {
      const code = String(row.ItemCode ?? "").trim().toUpperCase();
      let action: "INSERT" | "UPDATE" | "SKIP" = "SKIP";

      if (!code) {
        syncResult.failedCount++;
        syncResult.failedRows.push({ code: "UNKNOWN", error: "Empty item code" });
        syncResult.data.push({
          code: "UNKNOWN",
          action: "UPSERT",
          status: "FAILED",
          error: "Empty item code",
        });
        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "Item",
            referenceKey: "UNKNOWN",
            action: "UPSERT",
            status: "FAILED",
            errorMessage: "Empty item code",
          },
        });
        continue;
      }

      const existingItem = await prisma.item.findUnique({
        where: { itemCode: code },
      });

      const normalizedItemClassCode = String(row.itemClassCode ?? "").trim().toUpperCase();
      const normalizedUomCode = String(row.UOM ?? "").trim().toUpperCase();

      if (normalizedItemClassCode && ambiguousItemClassInitials.has(normalizedItemClassCode)) {
        syncResult.failedCount++;
        syncResult.failedRows.push({
          code,
          error: `Ambiguous ItemClass initials in staging for itemClassCode=${normalizedItemClassCode}`,
        });
        syncResult.data.push({
          code,
          action: "UPSERT",
          status: "FAILED",
          error: `Ambiguous ItemClass initials in staging for itemClassCode=${normalizedItemClassCode}`,
        });

        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "Item",
            referenceKey: code,
            action: "UPSERT",
            status: "FAILED",
            errorMessage: `Ambiguous ItemClass initials in staging for itemClassCode=${normalizedItemClassCode}`,
          },
        });

        continue;
      }

      const resolvedItemClassCode = normalizedItemClassCode
        ? itemClassCodeSet.has(normalizedItemClassCode)
          ? normalizedItemClassCode
          : (itemClassInitialsToCode.get(normalizedItemClassCode) ?? "")
        : "";

      if (normalizedItemClassCode && !resolvedItemClassCode) {
        syncResult.failedCount++;
        syncResult.failedRows.push({
          code,
          error: `Missing ItemClass in staging for itemClassCode=${normalizedItemClassCode} (no matching itmsGrpCod/initials)`,
        });
        syncResult.data.push({
          code,
          action: "UPSERT",
          status: "FAILED",
          error: `Missing ItemClass in staging for itemClassCode=${normalizedItemClassCode} (no matching itmsGrpCod/initials)`,
        });

        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "Item",
            referenceKey: code,
            action: "UPSERT",
            status: "FAILED",
            errorMessage: `Missing ItemClass in staging for itemClassCode=${normalizedItemClassCode} (no matching itmsGrpCod/initials)`,
          },
        });

        continue;
      }

      if (normalizedUomCode && !uomCodeToId.has(normalizedUomCode)) {
        syncResult.failedCount++;
        syncResult.failedRows.push({
          code,
          error: `Missing UOM in staging for uomCode=${normalizedUomCode}`,
        });
        syncResult.data.push({
          code,
          action: "UPSERT",
          status: "FAILED",
          error: `Missing UOM in staging for uomCode=${normalizedUomCode}`,
        });

        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "Item",
            referenceKey: code,
            action: "UPSERT",
            status: "FAILED",
            errorMessage: `Missing UOM in staging for uomCode=${normalizedUomCode}`,
          },
        });

        continue;
      }

      const resolvedUomId = normalizedUomCode ? (uomCodeToId.get(normalizedUomCode) ?? null) : null;

      const itemData = {
        itemDescription: row.ItemDescription ?? "",
        isActive: row.validFor === "Y",
        category: row.Category ?? "",
        itemClassCode: resolvedItemClassCode || null,
        itemClassName: row.itemClassName ?? null,
        uom: normalizedUomCode || null,
        uomId: resolvedUomId,
        leadTime: row.LeadTime ?? 0,
        isWHInventory: row.iswhInventory === 1,
        isSalesInventory: row.isSalesInventory === 1,
        isPurchaseInventory: row.isPurchaseInventory === 1,
        itemGroupName: row.ItemGroupName ?? null,
        updatedAt: new Date(),
      };

      if (!existingItem) {
        // INSERT
        try {
          await prisma.item.create({
            data: {
              itemCode: code,
              ...itemData,
            },
          });

          action = "INSERT";
          syncResult.insertedCount++;
        } catch (fkError: unknown) {
          // Handle foreign key constraint errors
          if ((fkError as any)?.code === "P2003") {
            syncResult.failedCount++;
            syncResult.failedRows.push({
              code,
              error: "Foreign key constraint failed - referenced item class or UOM does not exist",
            });
            syncResult.data.push({
              code,
              action: "UPSERT",
              status: "FAILED",
              error: "Foreign key constraint failed - referenced item class or UOM does not exist",
            });

            await prisma.auditTransactionItem.create({
              data: {
                auditLogId: auditLog.id,
                entity: "Item",
                referenceKey: code,
                action: "UPSERT",
                status: "FAILED",
                errorMessage: "FK constraint: itemClassCode or UOM not found",
              },
            });
            continue;
          }
          throw fkError;
        }
      } else {
        // CHECK FOR CHANGES
        let hasChanges = false;

        if (
          existingItem.itemDescription !== itemData.itemDescription ||
          existingItem.isActive !== itemData.isActive ||
          existingItem.category !== itemData.category ||
          existingItem.itemClassCode !== itemData.itemClassCode ||
          existingItem.itemClassName !== itemData.itemClassName ||
          existingItem.uom !== itemData.uom ||
          existingItem.uomId !== itemData.uomId ||
          existingItem.leadTime !== itemData.leadTime ||
          existingItem.isWHInventory !== itemData.isWHInventory ||
          existingItem.isSalesInventory !== itemData.isSalesInventory ||
          existingItem.isPurchaseInventory !== itemData.isPurchaseInventory ||
          existingItem.itemGroupName !== itemData.itemGroupName
        ) {
          hasChanges = true;
        }

        if (hasChanges) {
          try {
            await prisma.item.update({
              where: { itemCode: code },
              data: itemData,
            });

            action = "UPDATE";
            syncResult.updatedCount++;
          } catch (fkError: unknown) {
            // Handle foreign key constraint errors
            if ((fkError as any)?.code === "P2003") {
              syncResult.failedCount++;
              syncResult.failedRows.push({
                code,
                error: "Foreign key constraint failed - referenced item class or UOM does not exist",
              });

              await prisma.auditTransactionItem.create({
                data: {
                  auditLogId: auditLog.id,
                  entity: "Item",
                  referenceKey: code,
                  action: "UPSERT",
                  status: "FAILED",
                  errorMessage: "FK constraint: itemClassCode or UOM not found",
                },
              });
              continue;
            }
            throw fkError;
          }
        } else {
          action = "SKIP";
        }
      }

      if (action === "SKIP") {
        syncResult.data.push({
          code,
          action,
          status: "SUCCESS",
          reason: "Already up-to-date in staging",
        });
      } else {
        syncResult.data.push({
          code,
          action,
          status: "SUCCESS",
        });
      }

      // Log audit
      await prisma.auditTransactionItem.create({
        data: {
          auditLogId: auditLog.id,
          entity: "Item",
          referenceKey: code,
          action,
          status: "SUCCESS",
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      syncResult.failedCount++;
      syncResult.failedRows.push({ code: row.ItemCode ?? "UNKNOWN", error: errorMessage });
      syncResult.data.push({
        code: String(row.ItemCode ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
        action: "UPSERT",
        status: "FAILED",
        error: errorMessage,
      });

      try {
        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "Item",
            referenceKey: row.ItemCode ?? "UNKNOWN",
            action: "UPSERT",
            status: "FAILED",
            errorMessage,
          },
        });
      } catch {
      }
    }
  }

  const skippedCount = syncResult.totalRows - syncResult.insertedCount - syncResult.updatedCount - syncResult.failedCount;
  const finalStatus = syncResult.failedCount > 0 && (syncResult.insertedCount + syncResult.updatedCount + skippedCount) > 0
    ? "PARTIAL"
    : syncResult.failedCount > 0
      ? "FAILED"
      : "SUCCESS";

  syncResult.skippedCount = skippedCount;
  syncResult.processedCount = syncResult.totalRows;
  syncResult.successCount = syncResult.insertedCount + syncResult.updatedCount + skippedCount;
  syncResult.status = finalStatus;
  syncResult.endedAt = new Date().toISOString();

  await prisma.auditLog.update({
    where: { id: auditLog.id },
    data: {
      status: finalStatus,
      endedAt: new Date(syncResult.endedAt),
      insertedCount: syncResult.insertedCount,
      updatedCount: syncResult.updatedCount,
      skippedCount,
      failedCount: syncResult.failedCount,
    },
  });

  await prisma.auditLogDetail.create({
    data: {
      auditLogId: auditLog.id,
      level: "INFO",
      step: "COMPLETE",
      message: `Sync complete — inserted: ${syncResult.insertedCount}, updated: ${syncResult.updatedCount}, skipped: ${skippedCount}, failed: ${syncResult.failedCount}`,
    },
  });

  return syncResult;
}

/* ===================== MAIN EXPORT FUNCTIONS ===================== */

export async function runItemSync(): Promise<SyncResult> {
  const sourceRows = await fetchSAPItemsFromOITM();
  return syncItemRows({
    sourceRows,
    transactionCode: TRANSACTION_CODE,
    fetchMessage: "📥 Fetched from SAP",
  });
}

export async function runItemSyncByCodes(codes: string[]): Promise<SyncResult & { requestedCodes: string[]; foundCodes: string[]; missingCodes: string[] }> {
  const { requestedCodes, foundRows, missingCodes } = await fetchSAPItemsByCodes(codes);

  const syncResult = await syncItemRows({
    sourceRows: foundRows,
    transactionCode: TRANSACTION_CODE_SELECTED,
    fetchMessage: `📥 Fetched ${foundRows.length}/${requestedCodes.length} items from SAP`,
  });

  return {
    ...syncResult,
    requestedCodes,
    foundCodes: foundRows.map((r: SAPItemRow) => r.ItemCode.toUpperCase()),
    missingCodes,
  };
}
