import { env } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import { getSapPool } from "../../../lib/sap";

type PaginationParams = {
  page?: number;
  limit?: number;
  search?: string;
  uomCode?: string;
  uomName?: string;
  isActive?: boolean;
};

type UomData = {
  uomCode: string;
  uomName: string;
  isActive: boolean;
};

type GetUomResponse = {
  source: "staging" | "sap" | "sharepoint";
  filters: {
    search?: string;
    uomCode?: string;
    uomName?: string;
    isActive?: boolean;
  };
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  count: number;
  data: UomData[];
};

const normalizeText = (text: string): string => text.trim().toUpperCase();
const matchesText = (value: string, search: string): boolean => normalizeText(value).includes(normalizeText(search));

const normalizeLimit = (limit: unknown): number => {
  const num = Number(limit) || 100;
  return Math.min(Math.max(num, 1), 500);
};

const normalizePage = (page: unknown): number => {
  const num = Number(page) || 1;
  return Math.max(num, 1);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseSharePointActive = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "active";
  }

  return true;
};

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

export const getUomFromStaging = async (
  params: Partial<PaginationParams>,
): Promise<GetUomResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);
  const offset = (page - 1) * limit;

  const where: any = {};

  if (params.search) {
    where.OR = [
      { uomCode: { contains: normalizeText(params.search) } },
      { uomName: { contains: normalizeText(params.search) } },
    ];
  }

  if (params.uomCode) {
    where.uomCode = { contains: normalizeText(params.uomCode) };
  }

  if (params.uomName) {
    where.uomName = { contains: normalizeText(params.uomName) };
  }

  const [data, total] = await Promise.all([
    prisma.uom.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { uomCode: "asc" },
    }),
    prisma.uom.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;

  return {
    source: "staging",
    filters: {
      search: params.search,
      uomCode: params.uomCode,
      uomName: params.uomName,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: data.length,
    data: data.map((row) => ({
      uomCode: row.uomCode,
      uomName: row.uomName,
      isActive: true,
    })),
  };
};

const buildSapWhereClause = (params: Partial<PaginationParams>) => {
  const clauses: string[] = ["1=1"];
  const bindings: Array<{ name: string; value: string }> = [];

  if (params.search) {
    clauses.push("(UPPER(UomCode) LIKE @search OR UPPER(UomName) LIKE @search)");
    bindings.push({ name: "search", value: `%${normalizeText(params.search)}%` });
  }

  if (params.uomCode) {
    clauses.push("UPPER(UomCode) LIKE @uomCode");
    bindings.push({ name: "uomCode", value: `%${normalizeText(params.uomCode)}%` });
  }

  if (params.uomName) {
    clauses.push("UPPER(UomName) LIKE @uomName");
    bindings.push({ name: "uomName", value: `%${normalizeText(params.uomName)}%` });
  }

  return {
    whereClause: clauses.join(" AND "),
    bindings,
  };
};

export const getUomFromSap = async (
  params: Partial<PaginationParams>,
): Promise<GetUomResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);
  const offset = (page - 1) * limit;

  const pool = await getSapPool();
  const { whereClause, bindings } = buildSapWhereClause(params);

  const countRequest = pool.request();
  for (const binding of bindings) {
    countRequest.input(binding.name, binding.value);
  }

  const countResult = await countRequest.query<{ total: number }>(`
    SELECT COUNT(*) AS total
    FROM OUOM
    WHERE ${whereClause}
  `);

  const total = countResult.recordset[0]?.total || 0;

  const dataRequest = pool.request();
  for (const binding of bindings) {
    dataRequest.input(binding.name, binding.value);
  }

  const dataResult = await dataRequest.query<{ UomCode: string; UomName: string }>(`
    SELECT
      UPPER(UomCode) AS UomCode,
      UPPER(UomName) AS UomName
    FROM OUOM
    WHERE ${whereClause}
    ORDER BY UomCode ASC
    OFFSET ${offset} ROWS
    FETCH NEXT ${limit} ROWS ONLY
  `);

  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;

  return {
    source: "sap",
    filters: {
      search: params.search,
      uomCode: params.uomCode,
      uomName: params.uomName,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: dataResult.recordset.length,
    data: dataResult.recordset.map((row) => ({
      uomCode: row.UomCode,
      uomName: row.UomName,
      isActive: true,
    })),
  };
};

export const getUomFromSharePoint = async (
  params: Partial<PaginationParams>,
): Promise<GetUomResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);

  const { uomSiteId, uomListId } = env.sharePoint;
  if (!uomSiteId || !uomListId) {
    throw new Error("Missing SharePoint UOM target (SP_UOM_SITE_ID, SP_UOM_LIST_ID)");
  }

  const token = await getAccessToken();

  const allItems: UomData[] = [];
  let nextLink: string | undefined =
    `https://graph.microsoft.com/v1.0/sites/${uomSiteId}` +
    `/lists/${uomListId}/items?$expand=fields&$top=100`;

  while (nextLink) {
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
      ...(data.value || []).map((item) => ({
        uomCode: String(item.fields?.ShortDescription || item.fields?.UomCode || item.fields?.Code || "").trim().toUpperCase(),
        uomName: String(item.fields?.Description || item.fields?.UomName || item.fields?.Title || "").trim().toUpperCase(),
        isActive: parseSharePointActive(item.fields?.isActive ?? item.fields?.IsActive),
      })),
    );

    nextLink = data["@odata.nextLink"];
  }

  let filtered = allItems;

  if (params.search) {
    const searchTerm = normalizeText(params.search);
    filtered = filtered.filter(
      (item) => matchesText(item.uomCode, searchTerm) || matchesText(item.uomName, searchTerm),
    );
  }

  if (params.uomCode) {
    filtered = filtered.filter((item) => matchesText(item.uomCode, params.uomCode!));
  }

  if (params.uomName) {
    filtered = filtered.filter((item) => matchesText(item.uomName, params.uomName!));
  }

  if (typeof params.isActive === "boolean") {
    filtered = filtered.filter((item) => item.isActive === params.isActive);
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const offset = (page - 1) * limit;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    source: "sharepoint",
    filters: {
      search: params.search,
      uomCode: params.uomCode,
      uomName: params.uomName,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: paginated.length,
    data: paginated,
  };
};
