import { randomUUID } from "crypto";
import { getSapPool } from "../../../../lib/sap";
import { prisma } from "../../../../lib/prisma";

type SapWarehouseRow = {
  WhCode: string;
  WhName: string;
  Address: string | null;
  Inactive: string;
};

type WarehouseSyncItemResult = {
  whCode: string;
  action: "INSERT" | "UPDATE" | "SKIP";
  status: "SUCCESS" | "FAILED";
  reason?: string;
  error?: string;
  changes?: Array<{
    field: "whName" | "address" | "isActive";
    from: string | boolean | null;
    to: string | boolean | null;
  }>;
};

const TRANSACTION_CODE = "SAP2SDB_WAREHOUSE";
const TRANSACTION_CODE_SELECTED = "SAP2SDB_WAREHOUSE_SELECTED";

const getIncomingWarehouseValues = (row: SapWarehouseRow) => ({
  whName: row.WhName,
  address: row.Address ?? null,
  isActive: row.Inactive === "N",
});

const getWarehouseChanges = (
  existing: { whName: string; address: string | null; isActive: boolean },
  incoming: { whName: string; address: string | null; isActive: boolean },
) => {
  const changes: Array<{
    field: "whName" | "address" | "isActive";
    from: string | boolean | null;
    to: string | boolean | null;
  }> = [];

  if (existing.whName !== incoming.whName) {
    changes.push({ field: "whName", from: existing.whName, to: incoming.whName });
  }

  if (existing.address !== incoming.address) {
    changes.push({ field: "address", from: existing.address, to: incoming.address });
  }

  if (existing.isActive !== incoming.isActive) {
    changes.push({ field: "isActive", from: existing.isActive, to: incoming.isActive });
  }

  return changes;
};

const normalizeWhCodes = (whCodes: string[]) => {
  const normalized = whCodes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);

  return [...new Set(normalized)];
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
    data: {
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

const syncWarehousesFromSapRows = async ({
  sapRows,
  transactionCode,
  fetchMessage,
}: {
  sapRows: SapWarehouseRow[];
  transactionCode: string;
  fetchMessage: string;
}) => {
  const { runId, startedAt, auditLog } = await createAuditLog(transactionCode);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items: WarehouseSyncItemResult[] = [];

  try {
    const totalRecords = sapRows.length;

    await prisma.auditLog.update({
      where: { id: auditLog.id },
      data: { totalRecords },
    });

    await prisma.auditLogDetail.create({
      data: {
        auditLogId: auditLog.id,
        level: "INFO",
        step: "FETCH",
        message: fetchMessage,
      },
    });

    for (const row of sapRows) {
      try {
        const incoming = getIncomingWarehouseValues(row);
        const existing = await prisma.warehouse.findUnique({
          where: { whCode: row.WhCode },
        });

        if (existing) {
          const changes = getWarehouseChanges(existing, incoming);
          const isSame = changes.length === 0;

          if (isSame) {
            skipped++;
            items.push({
              whCode: row.WhCode,
              action: "SKIP",
              status: "SUCCESS",
              reason: "Already up-to-date in staging",
            });
            await prisma.auditTransactionItem.create({
              data: {
                auditLogId: auditLog.id,
                entity: "Warehouse",
                referenceKey: row.WhCode,
                action: "SKIP",
                status: "SUCCESS",
              },
            });
            continue;
          }

          await prisma.warehouse.update({
            where: { whCode: row.WhCode },
            data: {
              whName: incoming.whName,
              address: incoming.address,
              isActive: incoming.isActive,
              updatedAt: new Date(),
            },
          });

          updated++;
          items.push({
            whCode: row.WhCode,
            action: "UPDATE",
            status: "SUCCESS",
            changes,
          });
          await prisma.auditTransactionItem.create({
            data: {
              auditLogId: auditLog.id,
              entity: "Warehouse",
              referenceKey: row.WhCode,
              action: "UPDATE",
              status: "SUCCESS",
            },
          });
        } else {
          await prisma.warehouse.create({
            data: {
              whCode: row.WhCode,
              whName: incoming.whName,
              address: incoming.address,
              isActive: incoming.isActive,
            },
          });

          inserted++;
          items.push({
            whCode: row.WhCode,
            action: "INSERT",
            status: "SUCCESS",
          });
          await prisma.auditTransactionItem.create({
            data: {
              auditLogId: auditLog.id,
              entity: "Warehouse",
              referenceKey: row.WhCode,
              action: "INSERT",
              status: "SUCCESS",
            },
          });
        }
      } catch (itemErr) {
        const existing = await prisma.warehouse.findUnique({
          where: { whCode: row.WhCode },
        });
        const action = existing ? "UPDATE" : "INSERT";
        const errorMessage = (itemErr as Error).message;
        failed++;
        items.push({
          whCode: row.WhCode,
          action,
          status: "FAILED",
          error: errorMessage,
        });
        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "Warehouse",
            referenceKey: row.WhCode,
            action,
            status: "FAILED",
            errorMessage,
          },
        });
      }
    }

    const finalStatus = failed > 0 && inserted + updated + skipped > 0 ? "PARTIAL" : failed > 0 ? "FAILED" : "SUCCESS";

    await prisma.auditLog.update({
      where: { id: auditLog.id },
      data: {
        status: finalStatus,
        endedAt: new Date(),
        insertedCount: inserted,
        updatedCount: updated,
        skippedCount: skipped,
        failedCount: failed,
      },
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
      runId,
      status: finalStatus,
      totalRecords,
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
      data: {
        status: "FAILED",
        endedAt: new Date(),
        errorMessage: (err as Error).message,
      },
    });

    throw err;
  }
};

const fetchSapWarehousesByCodes = async (whCodes: string[]) => {
  const normalizedCodes = normalizeWhCodes(whCodes);

  if (normalizedCodes.length === 0) {
    return {
      requestedCodes: [],
      foundRows: [] as SapWarehouseRow[],
      missingCodes: [] as string[],
    };
  }

  const pool = await getSapPool();
  const request = pool.request();

  const placeholders = normalizedCodes.map((code, index) => {
    const paramName = `code${index}`;
    request.input(paramName, code);
    return `@${paramName}`;
  });

  const result = await request.query<SapWarehouseRow>(`
    SELECT
      UPPER(WhsCode)  AS WhCode,
      UPPER(WhsName)  AS WhName,
      UPPER(StreetNo) AS Address,
      Inactive
    FROM OWHS
    WHERE UPPER(WhsCode) IN (${placeholders.join(", ")})
    ORDER BY WhsCode ASC
  `);

  const foundCodeSet = new Set(result.recordset.map((row) => row.WhCode));
  const missingCodes = normalizedCodes.filter((code) => !foundCodeSet.has(code));

  return {
    requestedCodes: normalizedCodes,
    foundRows: result.recordset,
    missingCodes,
  };
};

export const runWarehouseSync = async () => {  
  const pool = await getSapPool();
  const result = await pool.request().query<SapWarehouseRow>(`
      SELECT
        UPPER(WhsCode)  AS WhCode,
        UPPER(WhsName)  AS WhName,
        UPPER(StreetNo) AS Address,
        Inactive
      FROM OWHS
    `);

  return syncWarehousesFromSapRows({
    sapRows: result.recordset,
    transactionCode: TRANSACTION_CODE,
    fetchMessage: `Fetched ${result.recordset.length} warehouses from SAP`,
  });
};

export const runWarehouseSyncByCodes = async (whCodes: string[]) => {
  const { requestedCodes, foundRows, missingCodes } = await fetchSapWarehousesByCodes(whCodes);

  const syncResult = await syncWarehousesFromSapRows({
    sapRows: foundRows,
    transactionCode: TRANSACTION_CODE_SELECTED,
    fetchMessage: `Fetched ${foundRows.length} warehouses from SAP for selected codes`,
  });

  return {
    ...syncResult,
    requestedCodes,
    foundCodes: foundRows.map((row) => row.WhCode),
    missingCodes,
    missingDetails: missingCodes.map((code) => ({
      whCode: code,
      status: "NOT_FOUND",
      reason: "Warehouse code not found in SAP (OWHS)",
    })),
  };
};



