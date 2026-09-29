import { getSapPool } from "../../../lib/sap";
import { prisma } from "../../../lib/prisma";
import { env } from "../../../config/env";

/* ===================== TYPES ===================== */

interface ItemFilterParams {
  page?: number;
  limit?: number;
  search?: string;
  itemCode?: string;
  itemDescription?: string;
  category?: string;
  itemClassCode?: string;
  itemGroupName?: string;
  isActive?: boolean;
}

interface ItemDataResponse<T> {
  source: "staging" | "sap" | "sharepoint";
  filters: {
    search?: string;
    itemCode?: string;
    itemDescription?: string;
    category?: string;
    itemClassCode?: string;
    itemGroupName?: string;
    isActive?: boolean;
  };
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  count: number;
  data: T[];
}

interface StagingItem {
  itemCode: string;
  itemDescription: string;
  isActive: boolean;
  category: string;
  itemClassCode: string | null;
  itemClassName: string | null;
  uom: string | null;
  leadTime: number;
  isWHInventory: boolean;
  isSalesInventory: boolean;
  isPurchaseInventory: boolean;
  itemGroupName: string | null;
}

interface SAPItem {
  itemCode: string;
  itemDescription: string;
  category: string;
  itemClassCode: string | null;
  itemClassName: string | null;
  uom: string | null;
  leadTime: number | null;
  iswhInventory: boolean;
  isSalesInventory: boolean;
  isPurchaseInventory: boolean;
  itemGroupName: string | null;
}

interface SharePointItemRaw {
  id: string;
  fields: {
    Title: string;
    ItemCode: string;
    ItemDescription: string;
    Category: string;
    Status: string;
    Entity: string;
    LeadTime: number;
    iswhInventory: number;
    itemClassCode: string;
    itemGroupCode: string;
    UOM_code: string;
    isModified: number;
    UOM?: string;
    UOM_ID?: number;
    itemGroup?: string;
    itg_ID?: number;
    ItemClass?: string;
    ItemClass_ID?: number;
    isSalesInventory?: number;
    PurchaseCategory?: number;
  };
}

interface SharePointItem {
  itemCode: string;
  itemDescription: string;
  category: string;
  status: string;
  entity: string;
  leadTime: number;
  iswhInventory: boolean;
  isSalesInventory: boolean;
  itemClassCode: string;
  itemGroupCode: string;
  uomCode: string;
  isModified: boolean;
  uom?: string;
  uomId?: number;
  itemGroup?: string;
  itemClass?: string;
}

const clean = (value: unknown): string =>
  String(value ?? "").replace(/\r\n|\r|\n/g, "").trim();

const normalizeLimit = (limit: unknown): number => {
  const num = Number(limit) || 20;
  return Math.min(Math.max(num, 1), 500);
};

const normalizePage = (page: unknown): number => {
  const num = Number(page) || 1;
  return Math.max(num, 1);
};

const buildFilters = (params: ItemFilterParams) => {
  const filters: ItemDataResponse<unknown>["filters"] = {};
  if (params.search) filters.search = params.search;
  if (params.itemCode) filters.itemCode = params.itemCode;
  if (params.itemDescription) filters.itemDescription = params.itemDescription;
  if (params.category) filters.category = params.category;
  if (params.itemClassCode) filters.itemClassCode = params.itemClassCode;
  if (params.itemGroupName) filters.itemGroupName = params.itemGroupName;
  if (typeof params.isActive === "boolean") filters.isActive = params.isActive;
  return filters;
};

/* ===================== STAGING SOURCE ===================== */

export async function getItemsFromStaging(
  params: ItemFilterParams,
): Promise<ItemDataResponse<StagingItem>> {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);
  const { search, itemCode, itemDescription, category, itemClassCode, itemGroupName, isActive } = params;

  const where: Record<string, unknown> = {};

  if (itemCode) where.itemCode = { contains: itemCode };
  if (itemDescription) where.itemDescription = { contains: itemDescription };
  if (category) where.category = { contains: category };
  if (itemClassCode) where.itemClassCode = { contains: itemClassCode };
  if (itemGroupName) where.itemGroupName = { contains: itemGroupName };
  if (typeof isActive === "boolean") where.isActive = isActive;

  if (search) {
    where.OR = [
      { itemCode: { contains: search } },
      { itemDescription: { contains: search } },
      { category: { contains: search } },
      { itemClassCode: { contains: search } },
      { itemClassName: { contains: search } },
      { itemGroupName: { contains: search } },
    ];
  }

  const total = await prisma.item.count({ where });
  const totalPages = Math.ceil(total / limit);
  const skip = (page - 1) * limit;

  const raw = await prisma.item.findMany({
    where,
    skip,
    take: limit,
    orderBy: { itemCode: "asc" },
  });

  const data: StagingItem[] = raw.map((item) => ({
    itemCode: clean(item.itemCode),
    itemDescription: clean(item.itemDescription),
    isActive: item.isActive,
    category: clean(item.category),
    itemClassCode: item.itemClassCode ? clean(item.itemClassCode) : null,
    itemClassName: item.itemClassName ? clean(item.itemClassName) : null,
    uom: item.uom ? clean(item.uom) : null,
    leadTime: item.leadTime,
    isWHInventory: item.isWHInventory,
    isSalesInventory: item.isSalesInventory,
    isPurchaseInventory: item.isPurchaseInventory,
    itemGroupName: item.itemGroupName ? clean(item.itemGroupName) : null,
  }));

  return {
    source: "staging",
    filters: buildFilters(params),
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    count: data.length,
    data,
  };
}

/* ===================== SAP SOURCE ===================== */

export async function getItemsFromSAP(
  params: ItemFilterParams,
): Promise<ItemDataResponse<SAPItem>> {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);
  const { search, itemCode, itemDescription, category, itemClassCode, itemGroupName } = params;

  const pool = await getSapPool();

  const query = `
    SELECT
      UPPER(itm.ItemCode)        AS ItemCode,
      UPPER(itm.ItemName)        AS ItemDescription,
      UPPER(itm.ItemType)        AS Category,
      grp.U_Initials             AS itemClassCode,
      UPPER(grp.ItmsGrpNam)      AS itemClassName,
      UPPER(uom.UomCode)         AS UOM,
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

  type SAPRaw = {
    ItemCode: string;
    ItemDescription: string;
    Category: string;
    itemClassCode: string | null;
    itemClassName: string | null;
    UOM: string | null;
    LeadTime: number | null;
    iswhInventory: string;
    isSalesInventory: string;
    isPurchaseInventory: string;
    ItemGroupName: string | null;
  };

  const result = await pool.request().query<SAPRaw>(query);
  let raw: SAPRaw[] = [...result.recordset];

  // Client-side filtering
  raw = raw.filter((item) => {
    if (itemCode && !item.ItemCode.includes(itemCode.toUpperCase())) return false;
    if (itemDescription && !item.ItemDescription.includes(itemDescription.toUpperCase())) return false;
    if (category && !item.Category.includes(category.toUpperCase())) return false;
    if (itemClassCode && (!item.itemClassCode || !item.itemClassCode.includes(itemClassCode.toUpperCase()))) return false;
    if (itemGroupName && (!item.ItemGroupName || !item.ItemGroupName.includes(itemGroupName.toUpperCase()))) return false;

    if (search) {
      const s = search.toUpperCase();
      return (
        item.ItemCode.includes(s) ||
        item.ItemDescription.includes(s) ||
        item.Category.includes(s) ||
        (item.itemClassCode?.includes(s) ?? false) ||
        (item.itemClassName?.includes(s) ?? false) ||
        (item.ItemGroupName?.includes(s) ?? false)
      );
    }

    return true;
  });

  const total = raw.length;
  const totalPages = Math.ceil(total / limit);
  const skip = (page - 1) * limit;

  const data: SAPItem[] = raw.slice(skip, skip + limit).map((item) => ({
    itemCode: clean(item.ItemCode),
    itemDescription: clean(item.ItemDescription),
    category: clean(item.Category),
    itemClassCode: item.itemClassCode ? clean(item.itemClassCode) : null,
    itemClassName: item.itemClassName ? clean(item.itemClassName) : null,
    uom: item.UOM ? clean(item.UOM) : null,
    leadTime: item.LeadTime,
    iswhInventory: item.iswhInventory === "Y",
    isSalesInventory: item.isSalesInventory === "Y",
    isPurchaseInventory: item.isPurchaseInventory === "Y",
    itemGroupName: item.ItemGroupName ? clean(item.ItemGroupName) : null,
  }));

  return {
    source: "sap",
    filters: buildFilters(params),
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    count: data.length,
    data,
  };
}

/* ===================== SHAREPOINT SOURCE ===================== */

export async function getItemsFromSharePoint(
  params: ItemFilterParams,
): Promise<ItemDataResponse<SharePointItem>> {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);
  const { search, itemCode, itemDescription, category, itemClassCode, itemGroupName } = params;

  const token = await getSharePointAccessToken();

  // Build server-side filter
  const filters: string[] = [];
  if (itemCode) filters.push(`fields/ItemCode eq '${itemCode.toUpperCase()}'`);
  if (itemDescription) filters.push(`substringof('${itemDescription.toUpperCase()}', fields/ItemDescription)`);
  if (category) filters.push(`substringof('${category.toUpperCase()}', fields/Category)`);
  if (itemClassCode) filters.push(`substringof('${itemClassCode.toUpperCase()}', fields/itemClassCode)`);
  if (itemGroupName) filters.push(`substringof('${itemGroupName.toUpperCase()}', fields/itemGroupCode)`);

  const filterQuery = filters.length > 0 ? `&$filter=${filters.join(" and ")}` : "";

  // Fetch using nextLink pagination - fetch ALL records first
  let allRaw: SharePointItemRaw[] = [];
  let nextLink: string | undefined =
    `https://graph.microsoft.com/v1.0/sites/${env.sharePoint.imSiteId}` +
    `/lists/${env.sharePoint.imListId}/items` +
    `?$expand=fields&$top=100${filterQuery}`;

  // Fetch all pages until no more nextLink
  while (nextLink) {
    const res = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`SharePoint API error: ${text}`);
    }

    const json = JSON.parse(text);
    allRaw = allRaw.concat(json.value || []);
    nextLink = json["@odata.nextLink"];
  }

  // Transform to flat structure
  let items: SharePointItem[] = allRaw.map((raw) => {
    const f = raw.fields;
    return {
      itemCode: clean(f.ItemCode).toUpperCase(),
      itemDescription: clean(f.ItemDescription),
      category: clean(f.Category).toUpperCase(),
      status: clean(f.Status).toUpperCase(),
      entity: clean(f.Entity),
      leadTime: Number(f.LeadTime || 0),
      iswhInventory: Number(f.iswhInventory || 0) === 1,
      isSalesInventory: Number(f.isSalesInventory || 0) === 1,
      itemClassCode: clean(f.itemClassCode).toUpperCase(),
      itemGroupCode: clean(f.itemGroupCode).toUpperCase(),
      uomCode: clean(f.UOM_code).toUpperCase(),
      isModified: Number(f.isModified || 0) === 1,
      uom: f.UOM ? clean(f.UOM).toUpperCase() : undefined,
      uomId: f.UOM_ID ? Number(f.UOM_ID) : undefined,
      itemGroup: f.itemGroup ? clean(f.itemGroup).toUpperCase() : undefined,
      itemClass: f.ItemClass ? clean(f.ItemClass).toUpperCase() : undefined,
    };
  });

  // Client-side search filter
  if (search) {
    const s = search.toUpperCase();
    items = items.filter(
      (item) =>
        item.itemCode.includes(s) ||
        item.itemDescription.toUpperCase().includes(s) ||
        item.category.includes(s) ||
        item.itemClassCode.includes(s) ||
        item.itemGroupCode.includes(s) ||
        (item.itemClass?.includes(s) ?? false) ||
        (item.itemGroup?.includes(s) ?? false),
    );
  }

  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const skip = (page - 1) * limit;
  const paginatedData = items.slice(skip, skip + limit);

  return {
    source: "sharepoint",
    filters: buildFilters(params),
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    count: paginatedData.length,
    data: paginatedData,
  };
}

/* ===================== HELPER: SharePoint Auth ===================== */

async function getSharePointAccessToken(): Promise<string> {
  const { spTenantId, spClientId, spClientSecret } = env.sharePoint;

  const url = `https://login.microsoftonline.com/${spTenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: spClientId,
    client_secret: spClientSecret,
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
    throw new Error(`SharePoint token error: ${text}`);
  }

  const data = JSON.parse(text);
  return data.access_token;
}
