import { env } from "../../../config/env";
import { getItemMasterPool } from "../../../lib/itemMaster";
import { prisma } from "../../../lib/prisma";

type PaginationParams = {
  page?: number;
  limit?: number;
  search?: string;
  itemGroupId?: string;
  initials?: string;
  name?: string;
  itemClassCode?: string;
  itemClass?: string;
  category?: string;
  isActive?: boolean;
};

type ItemGroupData = {
  itemGroupId: string;
  initials: string;
  name: string;
  itemClassCode: string;
  itemClass: string;
  category: string;
  isActive: boolean;
};

type GetItemGroupResponse = {
  source: "staging" | "itemmaster" | "sharepoint";
  filters: {
    search?: string;
    itemGroupId?: string;
    initials?: string;
    name?: string;
    itemClassCode?: string;
    itemClass?: string;
    category?: string;
    isActive?: boolean;
  };
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  count: number;
  data: ItemGroupData[];
};

type ItemMasterItemGroupRow = {
  ItemGroupID: string;
  Initials: string;
  Name: string;
  ItemClassCode: string | null;
  ItemClass: string | null;
  Category: string | null;
};

const normalizeText = (text: string): string => {
  return text.trim().toUpperCase();
};

const matchesText = (value: string, search: string): boolean => {
  return normalizeText(value).includes(normalizeText(search));
};

const normalizeLimit = (limit: unknown): number => {
  const num = Number(limit) || 100;
  return Math.min(Math.max(num, 1), 500);
};

const normalizePage = (page: unknown): number => {
  const num = Number(page) || 1;
  return Math.max(num, 1);
};

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

const toItemGroupData = (row: {
  itemGroupId: string;
  initials: string;
  name: string;
  itemClassCode: string;
  itemClass: string;
  category: string;
  isActive: boolean;
}): ItemGroupData => ({
  itemGroupId: row.itemGroupId,
  initials: row.initials,
  name: row.name,
  itemClassCode: row.itemClassCode,
  itemClass: row.itemClass,
  category: row.category,
  isActive: row.isActive,
});

export const getItemGroupFromStaging = async (
  params: Partial<PaginationParams>,
): Promise<GetItemGroupResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);
  const offset = (page - 1) * limit;

  let where: any = {};

  if (params.search) {
    where.OR = [
      { itemGroupId: { contains: normalizeText(params.search) } },
      { initials: { contains: normalizeText(params.search) } },
      { name: { contains: normalizeText(params.search) } },
      { itemClassCode: { contains: normalizeText(params.search) } },
      { itemClass: { contains: normalizeText(params.search) } },
      { category: { contains: normalizeText(params.search) } },
    ];
  }

  if (params.itemGroupId) where.itemGroupId = { contains: normalizeText(params.itemGroupId) };
  if (params.initials) where.initials = { contains: normalizeText(params.initials) };
  if (params.name) where.name = { contains: normalizeText(params.name) };
  if (params.itemClassCode) where.itemClassCode = { contains: normalizeText(params.itemClassCode) };
  if (params.itemClass) where.itemClass = { contains: normalizeText(params.itemClass) };
  if (params.category) where.category = { contains: normalizeText(params.category) };
  if (params.isActive !== undefined) where.isActive = params.isActive;

  const [data, total] = await Promise.all([
    prisma.itemGroup.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { itemGroupId: "asc" },
    }),
    prisma.itemGroup.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;

  return {
    source: "staging",
    filters: {
      search: params.search,
      itemGroupId: params.itemGroupId,
      initials: params.initials,
      name: params.name,
      itemClassCode: params.itemClassCode,
      itemClass: params.itemClass,
      category: params.category,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: data.length,
    data: data.map((row: any) =>
      toItemGroupData({
        itemGroupId: row.itemGroupId,
        initials: row.initials,
        name: row.name,
        itemClassCode: row.itemClassCode,
        itemClass: row.itemClass,
        category: row.category,
        isActive: row.isActive,
      }),
    ),
  };
};

const fetchItemMasterRows = async (): Promise<ItemMasterItemGroupRow[]> => {
  const pool = await getItemMasterPool();

  const result = await pool.request().query<ItemMasterItemGroupRow>(`
    SELECT
      IG.code AS ItemGroupID,
      UPPER(IG.initials) AS Initials,
      UPPER(IG.name) AS Name,
      UPPER(IC.initials) AS ItemClassCode,
      UPPER(IC.name) AS ItemClass,
      UPPER(IG.category) AS Category
    FROM item_groups IG
    LEFT JOIN item_classes IC
      ON IG.item_class_code = IC.code
    WHERE IG.initials IS NOT NULL
    ORDER BY IG.code
  `);

  return result.recordset;
};

export const getItemGroupFromItemMaster = async (
  params: Partial<PaginationParams>,
): Promise<GetItemGroupResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);

  const allRows = await fetchItemMasterRows();

  let filtered = allRows.map((row) =>
    toItemGroupData({
      itemGroupId: String(row.ItemGroupID ?? "").trim().toUpperCase(),
      initials: String(row.Initials ?? "").trim().toUpperCase(),
      name: String(row.Name ?? "").trim().toUpperCase(),
      itemClassCode: String(row.ItemClassCode ?? "").trim().toUpperCase(),
      itemClass: String(row.ItemClass ?? "").trim().toUpperCase(),
      category: String(row.Category ?? "").trim().toUpperCase(),
      isActive: true,
    }),
  );

  if (params.search) {
    const searchTerm = normalizeText(params.search);
    filtered = filtered.filter(
      (item) =>
        matchesText(item.itemGroupId, searchTerm) ||
        matchesText(item.initials, searchTerm) ||
        matchesText(item.name, searchTerm) ||
        matchesText(item.itemClassCode, searchTerm) ||
        matchesText(item.itemClass, searchTerm) ||
        matchesText(item.category, searchTerm),
    );
  }

  if (params.itemGroupId) filtered = filtered.filter((item) => matchesText(item.itemGroupId, params.itemGroupId!));
  if (params.initials) filtered = filtered.filter((item) => matchesText(item.initials, params.initials!));
  if (params.name) filtered = filtered.filter((item) => matchesText(item.name, params.name!));
  if (params.itemClassCode) filtered = filtered.filter((item) => matchesText(item.itemClassCode, params.itemClassCode!));
  if (params.itemClass) filtered = filtered.filter((item) => matchesText(item.itemClass, params.itemClass!));
  if (params.category) filtered = filtered.filter((item) => matchesText(item.category, params.category!));
  if (params.isActive !== undefined) filtered = filtered.filter((item) => item.isActive === params.isActive);

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const offset = (page - 1) * limit;
  const data = filtered.slice(offset, offset + limit);

  return {
    source: "itemmaster",
    filters: {
      search: params.search,
      itemGroupId: params.itemGroupId,
      initials: params.initials,
      name: params.name,
      itemClassCode: params.itemClassCode,
      itemClass: params.itemClass,
      category: params.category,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: data.length,
    data,
  };
};

const parseSharePointActive = (value: unknown): boolean => {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "active";
  }
  return true;
};

export const getItemGroupFromSharePoint = async (
  params: Partial<PaginationParams>,
): Promise<GetItemGroupResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);

  const siteId = process.env.SP_IG_SITE_ID;
  const listId = process.env.SP_IG_LIST_ID;

  if (!siteId || !listId) {
    throw new Error("Missing SharePoint item-group target (SP_IG_SITE_ID, SP_IG_LIST_ID)");
  }

  const token = await getAccessToken();

  const allItems: ItemGroupData[] = [];
  let nextLink: string | undefined = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=100`;

  while (nextLink && allItems.length < 10000) {
    const response = await graphFetchWithRetry(nextLink, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`SharePoint API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      value?: Array<{ fields?: Record<string, unknown> }>;
      "@odata.nextLink"?: string;
    };

    allItems.push(
      ...(data.value || []).map((item: any) =>
        toItemGroupData({
          itemGroupId: String(item.fields?.ItemGroupID || "").trim().toUpperCase(),
          initials: String(item.fields?.Code || "").trim().toUpperCase(),
          name: String(item.fields?.Description || "").trim().toUpperCase(),
          itemClassCode: String(item.fields?.ItemClassCode || "").trim().toUpperCase(),
          itemClass: String(item.fields?.ItemClass || "").trim().toUpperCase(),
          category: String(item.fields?.Category || "").trim().toUpperCase(),
          isActive: parseSharePointActive(item.fields?.isActive ?? item.fields?.IsActive),
        }),
      ),
    );

    nextLink = data["@odata.nextLink"];
  }

  let filtered = allItems;

  if (params.search) {
    const searchTerm = normalizeText(params.search);
    filtered = filtered.filter(
      (item) =>
        matchesText(item.itemGroupId, searchTerm) ||
        matchesText(item.initials, searchTerm) ||
        matchesText(item.name, searchTerm) ||
        matchesText(item.itemClassCode, searchTerm) ||
        matchesText(item.itemClass, searchTerm) ||
        matchesText(item.category, searchTerm),
    );
  }

  if (params.itemGroupId) filtered = filtered.filter((item) => matchesText(item.itemGroupId, params.itemGroupId!));
  if (params.initials) filtered = filtered.filter((item) => matchesText(item.initials, params.initials!));
  if (params.name) filtered = filtered.filter((item) => matchesText(item.name, params.name!));
  if (params.itemClassCode) filtered = filtered.filter((item) => matchesText(item.itemClassCode, params.itemClassCode!));
  if (params.itemClass) filtered = filtered.filter((item) => matchesText(item.itemClass, params.itemClass!));
  if (params.category) filtered = filtered.filter((item) => matchesText(item.category, params.category!));
  if (params.isActive !== undefined) filtered = filtered.filter((item) => item.isActive === params.isActive);

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const offset = (page - 1) * limit;
  const data = filtered.slice(offset, offset + limit);

  return {
    source: "sharepoint",
    filters: {
      search: params.search,
      itemGroupId: params.itemGroupId,
      initials: params.initials,
      name: params.name,
      itemClassCode: params.itemClassCode,
      itemClass: params.itemClass,
      category: params.category,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: data.length,
    data,
  };
};
