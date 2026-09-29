import { randomUUID } from "crypto";
import { env } from "../../../../config/env";
import { prisma } from "../../../../lib/prisma";

type UomSyncItem = {
  uomCode: string;
  action: "INSERT" | "UPDATE" | "SKIP";
  status: "SUCCESS" | "FAILED";
  reason?: string;
  error?: string;
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

    await sleep(1000 * (retry + 1));
    return graphFetchWithRetry(url, init, retry + 1);
  }

  return response;
};

const getExistingUom = async (token: string, siteId: string, listId: string, uomCode: string) => {
  const escapedCode = uomCode.replace(/'/g, "''");
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}` +
    `/lists/${listId}/items` +
    `?$expand=fields&$filter=fields/ShortDescription eq '${escapedCode}'`;

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

const hasChanges = (existingFields: Record<string, unknown> | undefined, uomName: string) => {
  if (!existingFields) return true;
  return norm(existingFields.Description) !== norm(uomName);
};

const ensureOk = async (response: Response, action: string) => {
  if (response.ok) return;
  const text = await response.text();
  throw new Error(`${action} failed: ${response.status} ${text}`);
};

export const logUomToSharePoint = async (
  token: string,
  siteId: string,
  listId: string,
  uom: { uomCode: string; uomName: string },
) => {
  const uomCode = norm(uom.uomCode);
  const uomName = norm(uom.uomName);

  const existing = await getExistingUom(token, siteId, listId, uomCode);

  if (!existing) {
    const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`;

    const payload = {
      fields: {
        Title: randomUUID(),
        ShortDescription: uomCode,
        Description: uomName,
        Entity: "HULMA",
      },
    };

    const response = await graphFetchWithRetry(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    await ensureOk(response, `Create UOM ${uomCode}`);
    return "created" as const;
  }

  if (!hasChanges(existing.fields, uomName)) {
    return "skipped" as const;
  }

  const updateUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${existing.id}/fields`;

  const updateResponse = await graphFetchWithRetry(updateUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Description: uomName,
      Entity: "HULMA",
    }),
  });

  await ensureOk(updateResponse, `Update UOM ${uomCode}`);
  return "updated" as const;
};

const normalizeUomCodes = (codes: string[]) => {
  const normalized = codes.map((code) => norm(code)).filter((code) => code.length > 0);
  return [...new Set(normalized)];
};

const runSyncForRows = async (uoms: Array<{ uomCode: string; uomName: string }>) => {
  const { uomSiteId, uomListId } = env.sharePoint;

  if (!uomSiteId || !uomListId) {
    throw new Error("Missing SharePoint UOM target (SP_UOM_SITE_ID, SP_UOM_LIST_ID)");
  }

  const token = await getAccessToken();
  const runId = randomUUID();
  const startedAt = new Date();

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items: UomSyncItem[] = [];

  for (const uom of uoms) {
    const uomCode = norm(uom.uomCode);

    try {
      const action = await logUomToSharePoint(token, uomSiteId, uomListId, {
        uomCode: uom.uomCode,
        uomName: uom.uomName,
      });

      if (action === "created") {
        inserted++;
        items.push({ uomCode, action: "INSERT", status: "SUCCESS" });
      } else if (action === "updated") {
        updated++;
        items.push({ uomCode, action: "UPDATE", status: "SUCCESS" });
      } else {
        skipped++;
        items.push({
          uomCode,
          action: "SKIP",
          status: "SUCCESS",
          reason: "Already up-to-date in SharePoint",
        });
      }
    } catch (error) {
      failed++;
      items.push({
        uomCode,
        action: "UPDATE",
        status: "FAILED",
        error: (error as Error).message,
      });
    }
  }

  const status = failed > 0 && inserted + updated + skipped > 0 ? "PARTIAL" : failed > 0 ? "FAILED" : "SUCCESS";

  return {
    module: "staging-sharepoint",
    entity: "uom",
    runId,
    status,
    totalRecords: uoms.length,
    inserted,
    updated,
    skipped,
    failed,
    items,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
  };
};

export const runUomStagingSharePointSync = async () => {
  const stagingUoms = await prisma.uom.findMany({
    orderBy: { uomCode: "asc" },
    select: { uomCode: true, uomName: true },
  });

  return runSyncForRows(stagingUoms);
};

export const runUomStagingSharePointSyncByCodes = async (codes: string[]) => {
  const requestedCodes = normalizeUomCodes(codes);

  const foundUoms = await prisma.uom.findMany({
    where: { uomCode: { in: requestedCodes } },
    orderBy: { uomCode: "asc" },
    select: { uomCode: true, uomName: true },
  });

  const foundCodes = foundUoms.map((uom) => uom.uomCode);
  const missingCodes = requestedCodes.filter((code) => !foundCodes.includes(code));

  const syncResult = await runSyncForRows(foundUoms);

  return {
    ...syncResult,
    requestedCodes,
    foundCodes,
    missingCodes,
  };
};
