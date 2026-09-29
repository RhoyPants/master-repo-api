import { randomUUID } from "crypto";
import { env } from "../../../../config/env";
import { prisma } from "../../../../lib/prisma";

type WarehouseSyncItem = {
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

const norm = (value: unknown) => String(value ?? "").trim().toUpperCase();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getAccessToken = async () => {
  const { tenantId, clientId, clientSecret } = env.sharePoint;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Missing SharePoint credentials (SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET)");
  }

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await response.json()) as { access_token?: string; error_description?: string };

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? "Failed to get SharePoint access token");
  }

  return data.access_token;
};

const graphFetchWithRetry = async (url: string, init: RequestInit, retry = 0): Promise<Response> => {
  const response = await fetch(url, init);

  if (response.status === 429 || response.status === 503) {
    if (retry >= 5) {
      throw new Error(`Graph throttling: max retries reached (${response.status})`);
    }

    const waitMs = 1000 * (retry + 1);
    await sleep(waitMs);
    return graphFetchWithRetry(url, init, retry + 1);
  }

  return response;
};

const getExistingWarehouse = async (token: string, siteId: string, listId: string, whCode: string) => {
  const escapedCode = whCode.replace(/'/g, "''");
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}` +
    `/lists/${listId}/items?$expand=fields&$filter=fields/wh_code eq '${escapedCode}'`;

  const response = await graphFetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = (await response.json()) as {
    value?: Array<{ id: string; fields?: Record<string, unknown> }>;
  };

  if (!response.ok) {
    throw new Error(`SharePoint check error: ${JSON.stringify(data)}`);
  }

  return data.value?.[0] ?? null;
};

const getChanges = (
  fields: Record<string, unknown>,
  incoming: { whName: string; address: string; isActive: number },
) => {
  const changes: Array<{
    field: "whName" | "address" | "isActive";
    from: string | boolean | null;
    to: string | boolean | null;
  }> = [];

  const spName = norm(fields.wh_name);
  const incomingName = norm(incoming.whName);
  if (spName !== incomingName) {
    changes.push({ field: "whName", from: spName || null, to: incomingName || null });
  }

  const spAddress = norm(fields.wh_address);
  const incomingAddress = norm(incoming.address);
  if (spAddress !== incomingAddress) {
    changes.push({ field: "address", from: spAddress || null, to: incomingAddress || null });
  }

  const spIsActive = Number(fields.isActive ?? 0) === 1;
  const incomingIsActive = incoming.isActive === 1;
  if (spIsActive !== incomingIsActive) {
    changes.push({ field: "isActive", from: spIsActive, to: incomingIsActive });
  }

  return changes;
};

const ensureOk = async (response: Response, action: string) => {
  if (response.ok) return;
  const text = await response.text();
  throw new Error(`${action} failed: ${response.status} ${text}`);
};

export const runWarehouseStagingSharePointSync = async () => {
  const { warehouseSiteId, warehouseListId } = env.sharePoint;

  if (!warehouseSiteId || !warehouseListId) {
    throw new Error("Missing SharePoint warehouse target (SP_WH_SITE_ID, SP_WH_LIST_ID)");
  }

  const runId = randomUUID();
  const startedAt = new Date();

  const token = await getAccessToken();
  const stagingWarehouses = await prisma.warehouse.findMany({
    orderBy: { whCode: "asc" },
  });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items: WarehouseSyncItem[] = [];

  for (const warehouse of stagingWarehouses) {
    const whCode = norm(warehouse.whCode);
    let pendingAction: "INSERT" | "UPDATE" = "UPDATE";
    const payloadFields = {
      wh_code: whCode,
      wh_name: norm(warehouse.whName),
      wh_address: norm(warehouse.address),
      isActive: warehouse.isActive ? 1 : 0,
    };

    try {
      const existing = await getExistingWarehouse(token, warehouseSiteId, warehouseListId, whCode);

      if (!existing) {
        pendingAction = "INSERT";
        const createUrl = `https://graph.microsoft.com/v1.0/sites/${warehouseSiteId}/lists/${warehouseListId}/items`;
        const createResponse = await graphFetchWithRetry(createUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              Title: randomUUID(),
              ...payloadFields,
            },
          }),
        });
        await ensureOk(createResponse, `Create warehouse ${whCode}`);

        inserted++;
        items.push({ whCode, action: "INSERT", status: "SUCCESS" });
        continue;
      }

      const changes = getChanges(existing.fields ?? {}, {
        whName: payloadFields.wh_name,
        address: payloadFields.wh_address,
        isActive: payloadFields.isActive,
      });

      if (changes.length === 0) {
        skipped++;
        items.push({
          whCode,
          action: "SKIP",
          status: "SUCCESS",
          reason: "Already up-to-date in SharePoint",
        });
        continue;
      }

      const updateUrl = `https://graph.microsoft.com/v1.0/sites/${warehouseSiteId}/lists/${warehouseListId}/items/${existing.id}/fields`;
      const updateResponse = await graphFetchWithRetry(updateUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadFields),
      });
      await ensureOk(updateResponse, `Update warehouse ${whCode}`);

      updated++;
      items.push({
        whCode,
        action: "UPDATE",
        status: "SUCCESS",
        changes,
      });
    } catch (error) {
      failed++;
      items.push({
        whCode,
        action: pendingAction,
        status: "FAILED",
        error: (error as Error).message,
      });
    }
  }

  const status = failed > 0 && inserted + updated + skipped > 0 ? "PARTIAL" : failed > 0 ? "FAILED" : "SUCCESS";

  return {
    module: "staging-sharepoint",
    entity: "warehouse",
    runId,
    status,
    totalRecords: stagingWarehouses.length,
    inserted,
    updated,
    skipped,
    failed,
    items,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
  };
};

const normalizeWhCodes = (whCodes: string[]): string[] => {
  const normalized = whCodes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);

  return [...new Set(normalized)];
};

const fetchActiveStagingWarehousesByCodes = async (whCodes: string[]) => {
  const normalized = normalizeWhCodes(whCodes);
  const found = await prisma.warehouse.findMany({
    where: { whCode: { in: normalized } },
    orderBy: { whCode: "asc" },
  });

  const foundCodes = found.map((w) => w.whCode);
  const missing = normalized.filter((code) => !foundCodes.includes(code));

  return {
    requestedCodes: normalized,
    foundWarehouses: found,
    missingCodes: missing,
  };
};

const syncWarehousesToSharePoint = async (
  warehouses: Awaited<ReturnType<typeof prisma.warehouse.findMany>>,
  token: string,
  siteId: string,
  listId: string,
) => {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const failedItems: WarehouseSyncItem[] = [];

  for (const warehouse of warehouses) {
    const whCode = norm(warehouse.whCode);
    let pendingAction: "INSERT" | "UPDATE" = "UPDATE";

    const payloadFields = {
      wh_code: whCode,
      wh_name: norm(warehouse.whName),
      wh_address: norm(warehouse.address),
      isActive: warehouse.isActive ? 1 : 0,
    };

    try {
      const existing = await getExistingWarehouse(token, siteId, listId, whCode);

      if (!existing) {
        pendingAction = "INSERT";
        const createUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`;
        const createResponse = await graphFetchWithRetry(createUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              Title: randomUUID(),
              ...payloadFields,
            },
          }),
        });
        await ensureOk(createResponse, `Create warehouse ${whCode}`);

        inserted++;
        continue;
      }

      const changes = getChanges(existing.fields ?? {}, {
        whName: payloadFields.wh_name,
        address: payloadFields.wh_address,
        isActive: payloadFields.isActive,
      });

      if (changes.length === 0) {
        skipped++;
        continue;
      }

      const updateUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${existing.id}/fields`;
      const updateResponse = await graphFetchWithRetry(updateUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadFields),
      });
      await ensureOk(updateResponse, `Update warehouse ${whCode}`);

      updated++;
    } catch (error) {
      failed++;
      failedItems.push({
        whCode,
        action: pendingAction,
        status: "FAILED",
        error: (error as Error).message,
      });
    }
  }

  return {
    totalRecords: warehouses.length,
    insertedCount: inserted,
    updatedCount: updated,
    skippedCount: skipped,
    failedCount: failed,
    failedItems,
  };
};

export const runWarehouseStagingSharePointSyncByCodes = async (whCodes: string[]) => {
  const { warehouseSiteId, warehouseListId } = env.sharePoint;

  if (!warehouseSiteId || !warehouseListId) {
    throw new Error("Missing SharePoint warehouse target (SP_WH_SITE_ID, SP_WH_LIST_ID)");
  }

  const runId = randomUUID();
  const startedAt = new Date();

  const { requestedCodes, foundWarehouses, missingCodes } =
    await fetchActiveStagingWarehousesByCodes(whCodes);

  const token = await getAccessToken();
  const result = await syncWarehousesToSharePoint(
    foundWarehouses,
    token,
    warehouseSiteId,
    warehouseListId,
  );

  const status =
    result.failedCount > 0 && result.insertedCount + result.updatedCount + result.skippedCount > 0
      ? "PARTIAL"
      : result.failedCount > 0
        ? "FAILED"
        : "SUCCESS";

  return {
    module: "staging-sharepoint",
    entity: "warehouse",
    runId,
    status,
    requestedCodes,
    missingCodes,
    ...result,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
  };
};