import { getSapPool } from "../../../lib/sap";
import { prisma } from "../../../lib/prisma";
import { env } from "../../../config/env";

type PaginationParams = {
  page?: number;
  limit?: number;
  search?: string;
  whCode?: string;
  whName?: string;
  isActive?: boolean;
};

type WarehouseData = {
  whCode: string;
  whName: string;
  address: string | null;
  isActive: boolean;
};

type GetWarehouseResponse = {
  source: "staging" | "sap" | "sharepoint";
  filters: {
    search?: string;
    whCode?: string;
    whName?: string;
    isActive?: boolean;
  };
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  count: number;
  data: WarehouseData[];
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

    const waitMs = 1000 * (retry + 1);
    await sleep(waitMs);
    return graphFetchWithRetry(url, init, retry + 1);
  }

  return response;
};

export const getWarehousesFromStaging = async (
  params: Partial<PaginationParams>,
): Promise<GetWarehouseResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);
  const offset = (page - 1) * limit;

  let where: any = {};

  if (params.search) {
    where.OR = [
      { whCode: { contains: normalizeText(params.search) } },
      { whName: { contains: normalizeText(params.search) } },
    ];
  }

  if (params.whCode) {
    where.whCode = { contains: normalizeText(params.whCode) };
  }

  if (params.whName) {
    where.whName = { contains: normalizeText(params.whName) };
  }

  if (params.isActive !== undefined) {
    where.isActive = params.isActive;
  }

  const [data, total] = await Promise.all([
    prisma.warehouse.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { whCode: "asc" },
    }),
    prisma.warehouse.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;

  return {
    source: "staging",
    filters: {
      search: params.search,
      whCode: params.whCode,
      whName: params.whName,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: data.length,
    data: data.map((wh: any) => ({
      whCode: wh.whCode,
      whName: wh.whName,
      address: wh.address,
      isActive: wh.isActive,
    })),
  };
};

export const getWarehousesFromSap = async (
  params: Partial<PaginationParams>,
): Promise<GetWarehouseResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);
  const offset = (page - 1) * limit;

  const pool = await getSapPool();
  let whereClause = "1=1";
  const request = pool.request();

  if (params.search) {
    whereClause += " AND (UPPER(WhsCode) LIKE @search OR UPPER(WhsName) LIKE @search)";
    request.input("search", `%${normalizeText(params.search)}%`);
  }

  if (params.whCode) {
    whereClause += " AND UPPER(WhsCode) LIKE @whCode";
    request.input("whCode", `%${normalizeText(params.whCode)}%`);
  }

  if (params.whName) {
    whereClause += " AND UPPER(WhsName) LIKE @whName";
    request.input("whName", `%${normalizeText(params.whName)}%`);
  }

  // Get total count
  const countResult = await request.query<{ total: number }>(`
    SELECT COUNT(*) as total
    FROM OWHS
    WHERE ${whereClause}
  `);

  const total = countResult.recordset[0]?.total || 0;

  // Get paginated data
  const dataResult = await pool.request().query<{
    WhCode: string;
    WhName: string;
    Address: string | null;
    Inactive: string;
  }>(`
    SELECT
      UPPER(WhsCode) as WhCode,
      UPPER(WhsName) as WhName,
      UPPER(StreetNo) as Address,
      Inactive
    FROM OWHS
    WHERE ${whereClause}
    ORDER BY WhsCode ASC
    OFFSET ${offset} ROWS
    FETCH NEXT ${limit} ROWS ONLY
  `);

  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;

  return {
    source: "sap",
    filters: {
      search: params.search,
      whCode: params.whCode,
      whName: params.whName,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: dataResult.recordset.length,
    data: dataResult.recordset.map((row: any) => ({
      whCode: row.WhCode,
      whName: row.WhName,
      address: row.Address ?? null,
      isActive: row.Inactive === "N",
    })),
  };
};

export const getWarehousesFromSharePoint = async (
  params: Partial<PaginationParams>,
): Promise<GetWarehouseResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);

  const token = await getAccessToken();

  // SharePoint collection
  const allItems: any[] = [];
  let nextLink: string | undefined = `https://graph.microsoft.com/v1.0/sites/${env.sharePoint.warehouseSiteId}/lists/${env.sharePoint.warehouseListId}/items?$expand=fields&$top=100`;

  // Fetch all items with pagination
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
      ...(data.value || []).map((item: any) => ({
        whCode: item.fields?.wh_code || item.fields?.WhCode || item.fields?.Code || "",
        whName: item.fields?.wh_name || item.fields?.WhName || item.fields?.Title || "",
        address: (item.fields?.wh_address || item.fields?.address || item.fields?.Address || null) as string | null,
        isActive: item.fields?.is_active !== false,
      })),
    );

    nextLink = data["@odata.nextLink"];
  }

  // Apply filters
  let filtered = allItems;

  if (params.search) {
    const searchTerm = normalizeText(params.search);
    filtered = filtered.filter(
      (item) =>
        matchesText(item.whCode, searchTerm) || matchesText(item.whName, searchTerm),
    );
  }

  if (params.whCode) {
    filtered = filtered.filter((item) => matchesText(item.whCode, params.whCode!));
  }

  if (params.whName) {
    filtered = filtered.filter((item) => matchesText(item.whName, params.whName!));
  }

  if (params.isActive !== undefined) {
    filtered = filtered.filter((item) => item.isActive === params.isActive);
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const offset = (page - 1) * limit;
  const data = filtered.slice(offset, offset + limit);

  return {
    source: "sharepoint",
    filters: {
      search: params.search,
      whCode: params.whCode,
      whName: params.whName,
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
