import { randomUUID } from "crypto";
import { env } from "../../../../config/env";
import { prisma } from "../../../../lib/prisma";

type ItemClassSyncItem = {
  itmsGrpCod: string;
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
    if (retry >= 5) throw new Error(`Graph throttling: max retries reached (${response.status})`);
    await sleep(1000 * (retry + 1));
    return graphFetchWithRetry(url, init, retry + 1);
  }

  return response;
};

const getExistingItem = async (token: string, siteId: string, listId: string, code: string) => {
  const escaped = code.replace(/'/g, "''");
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}` +
    `/lists/${listId}/items?$expand=fields&$filter=fields/Code eq '${escaped}'`;

  const response = await graphFetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = (await response.json()) as { value?: Array<{ id: string; fields?: Record<string, unknown> }> };

  if (!response.ok) throw new Error(`SharePoint check error: ${JSON.stringify(data)}`);

  return data.value?.[0] ?? null;
};

const getChanges = (
  fields: Record<string, unknown>,
  incoming: { itmsGrpNam: string; isActive: number },
) => {
  const changes: ItemClassSyncItem["changes"] = [];

  const spNam = norm(fields.Description);
  const incomingNam = norm(incoming.itmsGrpNam);
  if (spNam !== incomingNam) {
    changes!.push({ field: "itmsGrpNam", from: spNam || null, to: incomingNam || null });
  }

  const spIsActive = Number(fields.isActive ?? 0) === 1;
  const incomingIsActive = incoming.isActive === 1;
  if (spIsActive !== incomingIsActive) {
    changes!.push({ field: "isActive", from: spIsActive, to: incomingIsActive });
  }

  return changes!;
};

const ensureOk = async (response: Response, action: string) => {
  if (response.ok) return;
  const text = await response.text();
  throw new Error(`${action} failed: ${response.status} ${text}`);
};

export const runItemClassStagingSharePointSync = async () => {
  const { itemClassSiteId, itemClassListId } = env.sharePoint;

  if (!itemClassSiteId || !itemClassListId) {
    throw new Error("Missing SharePoint item class target (SP_IC_SITE_ID, SP_IC_LIST_ID)");
  }

  const runId = randomUUID();
  const startedAt = new Date();

  const token = await getAccessToken();
  const stagingRecords = await prisma.itemClass.findMany({ orderBy: { itmsGrpCod: "asc" } });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items: ItemClassSyncItem[] = [];

  for (const record of stagingRecords) {
    const initials = norm(record.initials);
    let pendingAction: "INSERT" | "UPDATE" = "UPDATE";

    const payloadFields = {
      Code: initials,
      Description: norm(record.itmsGrpNam),
      ItemClass_ID: norm(record.itmsGrpCod),
      Entity: "GVI",
    };

    try {
      const existing = await getExistingItem(token, itemClassSiteId, itemClassListId, initials);

      if (!existing) {
        pendingAction = "INSERT";
        const createUrl = `https://graph.microsoft.com/v1.0/sites/${itemClassSiteId}/lists/${itemClassListId}/items`;
        const createResponse = await graphFetchWithRetry(createUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fields: { Title: randomUUID(), ...payloadFields } }),
        });
        await ensureOk(createResponse, `Create item class ${initials}`);

        inserted++;
        items.push({ itmsGrpCod: record.itmsGrpCod, action: "INSERT", status: "SUCCESS" });
        continue;
      }

      const changes = getChanges(existing.fields ?? {}, {
        itmsGrpNam: payloadFields.Description,
        isActive: 0,
      });

      if (changes.length === 0) {
        skipped++;
        items.push({ itmsGrpCod: record.itmsGrpCod, action: "SKIP", status: "SUCCESS", reason: "Already up-to-date in SharePoint" });
        continue;
      }

      const updateUrl = `https://graph.microsoft.com/v1.0/sites/${itemClassSiteId}/lists/${itemClassListId}/items/${existing.id}/fields`;
      const updateResponse = await graphFetchWithRetry(updateUrl, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payloadFields),
      });
      await ensureOk(updateResponse, `Update item class ${initials}`);

      updated++;
      items.push({ itmsGrpCod: record.itmsGrpCod, action: "UPDATE", status: "SUCCESS", changes });
    } catch (error) {
      failed++;
      items.push({ itmsGrpCod: record.itmsGrpCod, action: pendingAction, status: "FAILED", error: (error as Error).message });
    }
  }

  const status = failed > 0 && inserted + updated + skipped > 0 ? "PARTIAL" : failed > 0 ? "FAILED" : "SUCCESS";

  return {
    module: "staging-sharepoint",
    entity: "item-class",
    runId, status,
    totalRecords: stagingRecords.length,
    inserted, updated, skipped, failed, items,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
  };
};
