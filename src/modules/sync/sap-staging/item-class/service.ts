import { randomUUID } from "crypto";
import { getSapPool } from "../../../../lib/sap";
import { prisma } from "../../../../lib/prisma";

type SapItemClassRow = {
  ItmsGrpCod: string;
  Initials: string;
  ItmsGrpNam: string;
};

type ItemClassSyncItemResult = {
  itmsGrpCod: string;
  initials: string;
  action: "INSERT" | "UPDATE" | "SKIP";
  status: "SUCCESS" | "FAILED";
  reason?: string;
  error?: string;
  changes?: Array<{
    field: "initials" | "itmsGrpNam" | "isActive";
    from: string | boolean | null;
    to: string | boolean | null;
  }>;
};

const TRANSACTION_CODE = "SAP2SDB_ITEMCLASS";
const TRANSACTION_CODE_SELECTED = "SAP2SDB_ITEMCLASS_SELECTED";

const normalizeCodes = (codes: string[]) => {
  const normalized = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);

  return [...new Set(normalized)];
};

const getIncomingValues = (row: SapItemClassRow) => ({
  initials: row.Initials,
  itmsGrpNam: row.ItmsGrpNam,
  isActive: true,
});

const getChanges = (
  existing: { initials: string; itmsGrpNam: string; isActive: boolean },
  incoming: { initials: string; itmsGrpNam: string; isActive: boolean },
) => {
  const changes: Array<{
    field: "initials" | "itmsGrpNam" | "isActive";
    from: string | boolean | null;
    to: string | boolean | null;
  }> = [];

  if (existing.initials !== incoming.initials) {
    changes.push({ field: "initials", from: existing.initials, to: incoming.initials });
  }

  if (existing.itmsGrpNam !== incoming.itmsGrpNam) {
    changes.push({ field: "itmsGrpNam", from: existing.itmsGrpNam, to: incoming.itmsGrpNam });
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

const syncItemClassFromSapRows = async ({
  sapRows,
  transactionCode,
  fetchMessage,
}: {
  sapRows: SapItemClassRow[];
  transactionCode: string;
  fetchMessage: string;
}) => {
  const { runId, startedAt, auditLog } = await createAuditLog(transactionCode);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items: ItemClassSyncItemResult[] = [];

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
        const incoming = getIncomingValues(row);
        const existing = await prisma.itemClass.findUnique({
          where: { itmsGrpCod: row.ItmsGrpCod },
        });

        if (existing) {
          const changes = getChanges(existing, incoming);

          if (changes.length === 0) {
            skipped++;
            items.push({
              itmsGrpCod: row.ItmsGrpCod,
              initials: row.Initials,
              action: "SKIP",
              status: "SUCCESS",
              reason: "Already up-to-date in staging",
            });

            await prisma.auditTransactionItem.create({
              data: {
                auditLogId: auditLog.id,
                entity: "ItemClass",
                referenceKey: row.ItmsGrpCod,
                action: "SKIP",
                status: "SUCCESS",
              },
            });
            continue;
          }

          await prisma.itemClass.update({
            where: { itmsGrpCod: row.ItmsGrpCod },
            data: {
              initials: incoming.initials,
              itmsGrpNam: incoming.itmsGrpNam,
              isActive: incoming.isActive,
              updatedAt: new Date(),
            },
          });

          updated++;
          items.push({
            itmsGrpCod: row.ItmsGrpCod,
            initials: row.Initials,
            action: "UPDATE",
            status: "SUCCESS",
            changes,
          });

          await prisma.auditTransactionItem.create({
            data: {
              auditLogId: auditLog.id,
              entity: "ItemClass",
              referenceKey: row.ItmsGrpCod,
              action: "UPDATE",
              status: "SUCCESS",
            },
          });
        } else {
          await prisma.itemClass.create({
            data: {
              itmsGrpCod: row.ItmsGrpCod,
              initials: incoming.initials,
              itmsGrpNam: incoming.itmsGrpNam,
              isActive: incoming.isActive,
            },
          });

          inserted++;
          items.push({
            itmsGrpCod: row.ItmsGrpCod,
            initials: row.Initials,
            action: "INSERT",
            status: "SUCCESS",
          });

          await prisma.auditTransactionItem.create({
            data: {
              auditLogId: auditLog.id,
              entity: "ItemClass",
              referenceKey: row.ItmsGrpCod,
              action: "INSERT",
              status: "SUCCESS",
            },
          });
        }
      } catch (itemErr) {
        const errorMessage = (itemErr as Error).message;
        const existing = await prisma.itemClass.findUnique({
          where: { itmsGrpCod: row.ItmsGrpCod },
        });
        const action = existing ? "UPDATE" : "INSERT";

        failed++;
        items.push({
          itmsGrpCod: row.ItmsGrpCod,
          initials: row.Initials,
          action,
          status: "FAILED",
          error: errorMessage,
        });

        await prisma.auditTransactionItem.create({
          data: {
            auditLogId: auditLog.id,
            entity: "ItemClass",
            referenceKey: row.ItmsGrpCod,
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

const fetchSapItemClassByCodes = async (codes: string[]) => {
  const normalizedCodes = normalizeCodes(codes);

  if (normalizedCodes.length === 0) {
    return {
      requestedCodes: [],
      foundRows: [] as SapItemClassRow[],
      missingCodes: [] as string[],
    };
  }

  const pool = await getSapPool();
  const request = pool.request();

  const codePlaceholders = normalizedCodes.map((code, index) => {
    const paramName = `code${index}`;
    request.input(paramName, code);
    return `@${paramName}`;
  });

  const initialsPlaceholders = normalizedCodes.map((code, index) => {
    const paramName = `initials${index}`;
    request.input(paramName, code);
    return `@${paramName}`;
  });

  const result = await request.query<SapItemClassRow>(`
    SELECT
      CAST(ItmsGrpCod AS NVARCHAR(50)) AS ItmsGrpCod,
      UPPER(ISNULL(U_Initials, ''))    AS Initials,
      UPPER(ItmsGrpNam)                AS ItmsGrpNam
    FROM OITB
    WHERE (CAST(ItmsGrpCod AS NVARCHAR(50)) IN (${codePlaceholders.join(", ")})
       OR UPPER(ISNULL(U_Initials, '')) IN (${initialsPlaceholders.join(", ")})
    )
    AND U_Initials IS NOT NULL
    ORDER BY U_Initials ASC
  `);

  const matchedInputs = new Set<string>();
  for (const row of result.recordset) {
    matchedInputs.add(String(row.ItmsGrpCod).toUpperCase());
    matchedInputs.add(String(row.Initials).toUpperCase());
  }

  const missingCodes = normalizedCodes.filter((code) => !matchedInputs.has(code));

  return {
    requestedCodes: normalizedCodes,
    foundRows: result.recordset,
    missingCodes,
  };
};

export const runItemClassSync = async () => {
  const pool = await getSapPool();
  const result = await pool.request().query<SapItemClassRow>(`
    SELECT
      CAST(ItmsGrpCod AS NVARCHAR(50)) AS ItmsGrpCod,
      UPPER(ISNULL(U_Initials, ''))    AS Initials,
      UPPER(ItmsGrpNam)                AS ItmsGrpNam
    FROM OITB
    WHERE U_Initials IS NOT NULL
    ORDER BY U_Initials ASC
  `);

  return syncItemClassFromSapRows({
    sapRows: result.recordset,
    transactionCode: TRANSACTION_CODE,
    fetchMessage: `Fetched ${result.recordset.length} item classes from SAP`,
  });
};

export const runItemClassSyncByCodes = async (codes: string[]) => {
  const { requestedCodes, foundRows, missingCodes } = await fetchSapItemClassByCodes(codes);

  const syncResult = await syncItemClassFromSapRows({
    sapRows: foundRows,
    transactionCode: TRANSACTION_CODE_SELECTED,
    fetchMessage: `Fetched ${foundRows.length} item classes from SAP for selected codes`,
  });

  return {
    ...syncResult,
    requestedCodes,
    foundCodes: foundRows.map((row) => row.ItmsGrpCod),
    missingCodes,
    missingDetails: missingCodes.map((code) => ({
      code,
      status: "NOT_FOUND",
      reason: "Item class code/initials not found in SAP (OITB)",
    })),
  };
};
