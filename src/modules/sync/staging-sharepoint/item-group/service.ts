import crypto from "crypto";
import { prisma } from "../../../../lib/prisma";

const {
  SP_TENANT_ID,
  SP_CLIENT_ID,
  SP_CLIENT_SECRET,
  SP_IG_SITE_ID,
  SP_IG_LIST_ID,
} = process.env;

type StagingItemGroup = {
  itemGroupId: string;
  initials: string;
  name: string;
  itemClassCode: string;
  itemClass: string;
  category: string;
};

type ItemGroupSharePointSyncItem = {
  itemGroupId: string;
  action: "INSERT" | "UPDATE" | "SKIP";
  status: "SUCCESS" | "FAILED";
  reason?: string;
  error?: string;
};

function generateGUID() {
  return crypto.randomUUID();
}

const norm = (value: unknown) => String(value ?? "").trim().toUpperCase();

export async function getAccessToken() {
  if (!SP_TENANT_ID || !SP_CLIENT_ID || !SP_CLIENT_SECRET) {
    throw new Error("Missing SharePoint credentials (SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET)");
  }

  const url = `https://login.microsoftonline.com/${SP_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: SP_CLIENT_ID,
    client_secret: SP_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`TOKEN ERROR: ${text}`);
  }

  const data = JSON.parse(text) as { access_token?: string };

  if (!data.access_token) {
    throw new Error("TOKEN ERROR: access token missing");
  }

  return data.access_token;
}

async function getExistingItemGroup(token: string, code: string) {
  if (!SP_IG_SITE_ID || !SP_IG_LIST_ID) {
    throw new Error("Missing SharePoint item-group target (SP_IG_SITE_ID, SP_IG_LIST_ID)");
  }

  const escapedCode = code.replace(/'/g, "''");

  const url =
    `https://graph.microsoft.com/v1.0/sites/${SP_IG_SITE_ID}` +
    `/lists/${SP_IG_LIST_ID}/items` +
    `?$expand=fields&$filter=fields/ItemGroupID eq '${escapedCode}'`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`SP CHECK ERROR: ${text}`);
  }

  const data = JSON.parse(text) as { value?: Array<{ id: string; fields?: Record<string, unknown> }> };

  return data.value?.[0] || null;
}

function hasChanges(existing: { fields?: Record<string, unknown> } | null, ig: {
  Initials: string;
  Name: string;
  ItemClassCode: string;
  ItemClass: string;
  Category: string;
}) {
  if (!existing || !existing.fields) return true;

  return (
    norm(existing.fields.Code) !== norm(ig.Initials) ||
    norm(existing.fields.Description) !== norm(ig.Name) ||
    norm(existing.fields.ItemClassCode) !== norm(ig.ItemClassCode) ||
    norm(existing.fields.ItemClass) !== norm(ig.ItemClass) ||
    norm(existing.fields.Category) !== norm(ig.Category)
  );
}

export async function logItemGroupToSharePoint(
  ig: {
    ItemGroupID: string;
    Initials: string;
    Name: string;
    ItemClassCode: string;
    ItemClass: string;
    Category: string;
  },
  token: string,
) {
  if (!SP_IG_SITE_ID || !SP_IG_LIST_ID) {
    throw new Error("Missing SharePoint item-group target (SP_IG_SITE_ID, SP_IG_LIST_ID)");
  }

  const code = String(ig.ItemGroupID).trim();
  const existing = await getExistingItemGroup(token, code);

  if (!existing) {
    const url =
      `https://graph.microsoft.com/v1.0/sites/${SP_IG_SITE_ID}` +
      `/lists/${SP_IG_LIST_ID}/items`;

    const payload = {
      fields: {
        Title: generateGUID(),
        ItemGroupID: code,
        Code: ig.Initials,
        Description: ig.Name,
        ItemClassCode: ig.ItemClassCode,
        ItemClass: ig.ItemClass,
        Category: ig.Category,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`SP CREATE ERROR: ${text}`);
    }

    return "created" as const;
  }

  if (!hasChanges(existing, ig)) {
    return "skipped" as const;
  }

  const updateUrl =
    `https://graph.microsoft.com/v1.0/sites/${SP_IG_SITE_ID}` +
    `/lists/${SP_IG_LIST_ID}/items/${existing.id}/fields`;

  const updatePayload = {
    Title: generateGUID(),
    Code: ig.Initials,
    Description: ig.Name,
    ItemClassCode: ig.ItemClassCode,
    ItemClass: ig.ItemClass,
    Category: ig.Category,
  };

  const res = await fetch(updateUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updatePayload),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`SP UPDATE ERROR: ${text}`);
  }

  return "updated" as const;
}

export const runItemGroupStagingSharePointSync = async () => {
  if (!SP_IG_SITE_ID || !SP_IG_LIST_ID) {
    throw new Error("Missing SharePoint item-group target (SP_IG_SITE_ID, SP_IG_LIST_ID)");
  }

  const runId = generateGUID();
  const startedAt = new Date();

  const token = await getAccessToken();
  const stagingItemGroups = await prisma.itemGroup.findMany({
    where: { isActive: true },
    orderBy: { itemGroupId: "asc" },
  });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const items: ItemGroupSharePointSyncItem[] = [];

  for (const group of stagingItemGroups as StagingItemGroup[]) {
    try {
      const result = await logItemGroupToSharePoint(
        {
          ItemGroupID: norm(group.itemGroupId),
          Initials: norm(group.initials),
          Name: norm(group.name),
          ItemClassCode: norm(group.itemClassCode),
          ItemClass: norm(group.itemClass),
          Category: norm(group.category),
        },
        token,
      );

      if (result === "created") {
        inserted++;
        items.push({ itemGroupId: group.itemGroupId, action: "INSERT", status: "SUCCESS" });
      } else if (result === "updated") {
        updated++;
        items.push({ itemGroupId: group.itemGroupId, action: "UPDATE", status: "SUCCESS" });
      } else {
        skipped++;
        items.push({
          itemGroupId: group.itemGroupId,
          action: "SKIP",
          status: "SUCCESS",
          reason: "Already up-to-date in SharePoint",
        });
      }
    } catch (error) {
      failed++;
      items.push({
        itemGroupId: group.itemGroupId,
        action: "UPDATE",
        status: "FAILED",
        error: (error as Error).message,
      });
    }
  }

  const status = failed > 0 && inserted + updated + skipped > 0 ? "PARTIAL" : failed > 0 ? "FAILED" : "SUCCESS";

  return {
    module: "staging-sharepoint",
    entity: "item-group",
    runId,
    status,
    totalRecords: stagingItemGroups.length,
    inserted,
    updated,
    skipped,
    failed,
    items,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
  };
};
