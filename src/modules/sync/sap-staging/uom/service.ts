import { auditActorData } from "../../../../lib/audit-context";
import { randomUUID } from "crypto";
import { getSapPool } from "../../../../lib/sap";
import { prisma } from "../../../../lib/prisma";

type SapUomRow = {
  UomCode: string;
  UomName: string;
};

type UomSyncItemResult = {
  uomCode: string;
  action: "INSERT" | "UPDATE" | "SKIP";
  status: "SUCCESS" | "FAILED";
  reason?: string;
  error?: string;
  changes?: Array<{
    field: "uomName";
    from: string | null;
    to: string | null;
  }>;
};

const TRANSACTION_CODE = "SAP2SDB_UOM";
const TRANSACTION_CODE_SELECTED = "SAP2SDB_UOM_SELECTED";

const normalizeCodes = (codes: string[]) => {
  const normalized = codes
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

export const fetchSapUomsByCodes = async (codes: string[]) => {
  const requestedCodes = normalizeCodes(codes);

  if (requestedCodes.length === 0) {
    return {
      requestedCodes,
      foundRows: [] as SapUomRow[],
      missingCodes: [] as string[],
    };
  }

  const pool = await getSapPool();
  const request = pool.request();

  const placeholders = requestedCodes.map((code, index) => {
    const paramName = `code${index}`;
    request.input(paramName, code);
    return `@${paramName}`;
  });

  const result = await request.query<SapUomRow>(`
    SELECT
      UPPER(UomCode) AS UomCode,
      UPPER(UomName) AS UomName
    FROM OUOM
    WHERE UPPER(UomCode) IN (${placeholders.join(", ")})
    ORDER BY UomCode
  `);

  const foundCodeSet = new Set(result.recordset.map((row) => row.UomCode));
  const missingCodes = requestedCodes.filter((code) => !foundCodeSet.has(code));

  return {
    requestedCodes,
    foundRows: result.recordset,
    missingCodes,
  };
};

const syncUomFromSapRows = async ({
  sapRows,
  transactionCode,
  fetchMessage,
}: {
  sapRows: SapUomRow[];
  transactionCode: string;
  fetchMessage: string;
}) => {
  const { runId, startedAt, auditLog } = await createAuditLog(transactionCode);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items: UomSyncItemResult[] = [];

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
      const uomCode = String(row.UomCode ?? "").trim().toUpperCase();
      const uomName = String(row.UomName ?? "").trim().toUpperCase();

      if (!uomCode) {
        failed++;
        items.push({
          uomCode: "UNKNOWN",
          action: "INSERT",
          status: "FAILED",
          error: "Empty UOM code",
        });

        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "UOM",
            referenceKey: "UNKNOWN",
            action: "UPSERT",
            status: "FAILED",
            errorMessage: "Empty UOM code",
          },
        });

        continue;
      }

      try {
        const existing = await prisma.uom.findUnique({
          where: { uomCode },
        });

        if (!existing) {
          await prisma.uom.create({
            data: {
              uomCode,
              uomName,
            },
          });

          inserted++;
          items.push({
            uomCode,
            action: "INSERT",
            status: "SUCCESS",
          });

          await prisma.auditTransactionItem.create({
            data: {
              auditLogId: auditLog.id,
              entity: "UOM",
              referenceKey: uomCode,
              action: "INSERT",
              status: "SUCCESS",
            },
          });

          continue;
        }

        if (existing.uomName === uomName) {
          skipped++;
          items.push({
            uomCode,
            action: "SKIP",
            status: "SUCCESS",
            reason: "Already up-to-date in staging",
          });

          await prisma.auditTransactionItem.create({
            data: {
              auditLogId: auditLog.id,
              entity: "UOM",
              referenceKey: uomCode,
              action: "SKIP",
              status: "SUCCESS",
            },
          });

          continue;
        }

        await prisma.uom.update({
          where: { uomCode },
          data: {
            uomName,
            updatedAt: new Date(),
          },
        });

        updated++;
        items.push({
          uomCode,
          action: "UPDATE",
          status: "SUCCESS",
          changes: [{ field: "uomName", from: existing.uomName, to: uomName }],
        });

        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "UOM",
            referenceKey: uomCode,
            action: "UPDATE",
            status: "SUCCESS",
              payload: JSON.stringify({ changes: [{ field: "uomName", from: existing.uomName, to: uomName }] }),
          },
        });
      } catch (itemErr) {
        const existing = await prisma.uom.findUnique({
          where: { uomCode },
        });

        const action = existing ? "UPDATE" : "INSERT";
        const errorMessage = (itemErr as Error).message;

        failed++;
        items.push({
          uomCode,
          action,
          status: "FAILED",
          error: errorMessage,
        });

        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "UOM",
            referenceKey: uomCode,
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

export const fetchSapUoms = async () => {
  const pool = await getSapPool();
  const result = await pool.request().query<SapUomRow>(`
    SELECT
      UPPER(UomCode) AS UomCode,
      UPPER(UomName) AS UomName
    FROM OUOM
    ORDER BY UomCode
  `);

  return result.recordset;
};

export const runUomSync = async () => {
  const rows = await fetchSapUoms();
  return syncUomFromSapRows({
    sapRows: rows,
    transactionCode: TRANSACTION_CODE,
    fetchMessage: `Fetched ${rows.length} UOM rows from SAP`,
  });
};

export const runUomSyncByCodes = async (codes: string[]) => {
  const { requestedCodes, foundRows, missingCodes } = await fetchSapUomsByCodes(codes);

  const syncResult = await syncUomFromSapRows({
    sapRows: foundRows,
    transactionCode: TRANSACTION_CODE_SELECTED,
    fetchMessage: `Fetched ${foundRows.length} UOM rows from SAP for selected codes`,
  });

  return {
    ...syncResult,
    requestedCodes,
    foundCodes: foundRows.map((row) => row.UomCode),
    missingCodes,
  };
};
