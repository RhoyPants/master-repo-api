import crypto from "crypto";
import { prisma } from "../../../../lib/prisma";

const { SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET, SP_IM_SITE_ID, SP_IM_LIST_ID } = process.env;

/* ===================== UTIL ===================== */

function generateGUID(): string {
  return crypto.randomUUID();
}

/* ===================== AUTH ===================== */

export async function getAccessToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${SP_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: SP_CLIENT_ID!,
    client_secret: SP_CLIENT_SECRET!,
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

  const data = JSON.parse(text);

  return data.access_token;
}

/* ===================== CHECK EXISTING ===================== */

async function getExistingItem(token: string, code: string): Promise<{ id: string; fields: Record<string, unknown> } | null> {
  const escapedCode = code.replace(/'/g, "''");
  const url =
    `https://graph.microsoft.com/v1.0/sites/${SP_IM_SITE_ID}` +
    `/lists/${SP_IM_LIST_ID}/items` +
    `?$expand=fields&$filter=fields/ItemCode eq '${escapedCode}'`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`SP CHECK ERROR: ${text}`);
  }

  const data = JSON.parse(text);

  return data.value?.[0] || null;
}

/* ===================== CHANGE CHECK ===================== */

function hasChanges(existing: { fields: Record<string, unknown> }, item: StagingItemForSync): boolean {
  if (!existing || !existing.fields) return true;

  const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

  const newStatus = item.isActive ? "ACTIVE" : "INACTIVE";
  const existingStatus = norm(existing.fields.Status);

  return (
    norm(existing.fields.ItemDescription) !== norm(item.itemDescription) ||
    norm(existing.fields.Category) !== norm(item.category) ||
    Number(existing.fields.LeadTime ?? 0) !== Number(item.leadTime ?? 0) ||
    Number(existing.fields.iswhInventory ?? 0) !== (item.isWHInventory ? 1 : 0) ||
    norm(existing.fields.itemClassCode) !== norm(item.itemClassCode) ||
    norm(existing.fields.itemGroupCode) !== norm(item.itemGroupCode) ||
    existingStatus !== newStatus ||
    norm(existing.fields.UOM_code) !== norm(item.uom)
  );
}

/* ===================== MAIN ===================== */

export async function logItemToSharePoint(item: StagingItemForSync, token: string): Promise<"created" | "updated" | "skipped"> {
  const code = String(item.itemCode ?? "").trim().toUpperCase();
  const statusValue = item.isActive ? "ACTIVE" : "INACTIVE";

  const existing = await getExistingItem(token, code);

  const payloadFields = {
    Title: generateGUID(),

    ItemCode: code,
    ItemDescription: item.itemDescription ?? "",
    Category: item.category ?? "",

    Status: statusValue,

    Entity: "GVI",

    LeadTime: item.leadTime ?? 0,
    iswhInventory: Number(item.isWHInventory ? 1 : 0),

    itemClassCode: item.itemClassCode ?? "",
    itemGroupCode: item.itemGroupCode ?? "",

    UOM_code: item.uom ?? "",

    isModified: 0,
  };

  /* ===================== CREATE ===================== */

  if (!existing) {
    const url = `https://graph.microsoft.com/v1.0/sites/${SP_IM_SITE_ID}` + `/lists/${SP_IM_LIST_ID}/items`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: payloadFields }),
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`SP CREATE ERROR: ${text}`);
    }

    return "created";
  }

  /* ===================== SKIP ===================== */

  if (!hasChanges(existing, item)) {
    return "skipped";
  }

  /* ===================== UPDATE ===================== */

  const updateUrl = `https://graph.microsoft.com/v1.0/sites/${SP_IM_SITE_ID}` + `/lists/${SP_IM_LIST_ID}/items/${existing.id}/fields`;

  const updatePayload = {
    ItemDescription: String(item.itemDescription ?? "").trim().toUpperCase(),
    Category: String(item.category ?? "").trim().toUpperCase(),
    Status: statusValue,
    LeadTime: item.leadTime ?? 0,
    iswhInventory: item.isWHInventory ? 1 : 0,
    itemClassCode: String(item.itemClassCode ?? "").trim().toUpperCase(),
    itemGroupCode: String(item.itemGroupCode ?? "").trim().toUpperCase(),
    UOM_code: String(item.uom ?? "").trim().toUpperCase(),
    isModified: 1,
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

  return "updated";
}

/* ===================== BATCH SYNC ===================== */

interface BatchSyncResult {
  totalItems: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  failedItems: Array<{ code: string; error: string }>;
}

type StagingItemForSync = {
  itemCode: string;
  itemDescription: string;
  isActive: boolean;
  category: string;
  uom: string | null;
  leadTime: number;
  isWHInventory: boolean;
  itemClassCode: string | null;   // resolved initials (e.g. ITR, ADM)
  itemGroupCode: string | null;
};

function normalizeItemCodes(codes: string[]): string[] {
  return [...new Set(codes.map((c) => String(c ?? "").trim().toUpperCase()))].filter((c) => c.length > 0);
}

async function fetchItemsWithGroupCode(where: Record<string, unknown>): Promise<StagingItemForSync[]> {
  const items = await prisma.item.findMany({
    where,
    orderBy: { itemCode: "asc" },
  });

  // Load ItemGroups for initials lookup by name
  const itemGroups = await prisma.itemGroup.findMany({
    select: { name: true, initials: true },
  });

  const nameToInitials = new Map<string, string>();
  for (const g of itemGroups) {
    nameToInitials.set(String(g.name ?? "").trim().toUpperCase(), String(g.initials ?? "").trim().toUpperCase());
  }

  // Load ItemClasses for itmsGrpCod → initials lookup
  const itemClasses = await prisma.itemClass.findMany({
    select: { itmsGrpCod: true, initials: true },
  });

  const itmsGrpCodToInitials = new Map<string, string>();
  for (const ic of itemClasses) {
    itmsGrpCodToInitials.set(String(ic.itmsGrpCod ?? "").trim().toUpperCase(), String(ic.initials ?? "").trim().toUpperCase());
  }

  return items.map((item) => {
    const rawItemClassCode = String(item.itemClassCode ?? "").trim().toUpperCase();
    const resolvedItemClassCode = (itmsGrpCodToInitials.get(rawItemClassCode) ?? rawItemClassCode) || null;

    return {
      itemCode: item.itemCode,
      itemDescription: item.itemDescription,
      isActive: item.isActive,
      category: item.category,
      uom: item.uom,
      leadTime: item.leadTime,
      isWHInventory: item.isWHInventory,
      itemClassCode: resolvedItemClassCode || null,
      itemGroupCode: item.itemGroupName
        ? (nameToInitials.get(String(item.itemGroupName).trim().toUpperCase()) ?? null)
        : null,
    };
  });
}

async function fetchActiveStagingItemsByCodes(codes: string[]) {
  const normalizedCodes = normalizeItemCodes(codes);

  if (normalizedCodes.length === 0) {
    return { requestedCodes: [], foundItems: [] as StagingItemForSync[], missingCodes: [] as string[] };
  }

  const foundItems = await fetchItemsWithGroupCode({
    isActive: true,
    itemCode: { in: normalizedCodes },
  });

  const foundCodes = foundItems.map((item) => String(item.itemCode ?? "").toUpperCase());
  const missingCodes = normalizedCodes.filter((code) => !foundCodes.includes(code));

  return { requestedCodes: normalizedCodes, foundItems, missingCodes };
}

async function syncItemsToSharePoint(items: StagingItemForSync[], token: string): Promise<BatchSyncResult> {
  const result: BatchSyncResult = {
    totalItems: items.length,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failedItems: [],
  };

  for (const item of items) {
    try {
      const status = await logItemToSharePoint(item, token);

      if (status === "created") {
        result.createdCount++;
      } else if (status === "updated") {
        result.updatedCount++;
      } else if (status === "skipped") {
        result.skippedCount++;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.failedCount++;
      result.failedItems.push({
        code: String(item.itemCode ?? "UNKNOWN"),
        error: errorMessage,
      });
    }
  }

  return result;
}

export async function runItemStagingSharePointSync(): Promise<BatchSyncResult> {
  const token = await getAccessToken();

  const items = await fetchItemsWithGroupCode({ isActive: true });

  const result: BatchSyncResult = {
    totalItems: items.length,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failedItems: [],
  };

  if (items.length === 0) return result;

  const syncResult = await syncItemsToSharePoint(items, token);
  result.createdCount = syncResult.createdCount;
  result.updatedCount = syncResult.updatedCount;
  result.skippedCount = syncResult.skippedCount;
  result.failedCount = syncResult.failedCount;
  result.failedItems = syncResult.failedItems;

  return result;
}

export async function runItemStagingSharePointSyncByCodes(codes: string[]) {
  const token = await getAccessToken();
  const { requestedCodes, foundItems, missingCodes } = await fetchActiveStagingItemsByCodes(codes);

  const syncResult = await syncItemsToSharePoint(foundItems, token);

  return {
    ...syncResult,
    requestedCodes,
    foundCodes: foundItems.map((item) => String(item.itemCode ?? "").toUpperCase()),
    missingCodes,
  };
}
