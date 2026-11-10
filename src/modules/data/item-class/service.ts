import { cachedDataRead } from "../../../lib/data-read-cache";
import { getSharePointReadToken } from "../../../lib/sharepoint-token";
import { env } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import { getSapPool } from "../../../lib/sap";

type PaginationParams = {
  page?: number;
  limit?: number;
  search?: string;
  itmsGrpCod?: string;
  initials?: string;
  itmsGrpNam?: string;
  isActive?: boolean;
};

type ItemClassData = {
  itmsGrpCod: string;
  initials: string;
  itmsGrpNam: string;
  isActive: boolean;
};

type GetItemClassResponse = {
  source: "staging" | "sap" | "sharepoint";
  filters: {
    search?: string;
    itmsGrpCod?: string;
    initials?: string;
    itmsGrpNam?: string;
    isActive?: boolean;
  };
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  count: number;
  data: ItemClassData[];
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

const getAccessToken = getSharePointReadToken;

const graphFetchWithRetry = async (url: string, init: RequestInit, retry = 0): Promise<Response> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });

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

export const getItemClassFromStaging = async (
  params: Partial<PaginationParams>,
): Promise<GetItemClassResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);
  const offset = (page - 1) * limit;

  let where: any = {};

  if (params.search) {
    where.OR = [
      { itmsGrpCod: { contains: normalizeText(params.search) } },
      { initials: { contains: normalizeText(params.search) } },
      { itmsGrpNam: { contains: normalizeText(params.search) } },
    ];
  }

  if (params.itmsGrpCod) {
    where.itmsGrpCod = { contains: normalizeText(params.itmsGrpCod) };
  }

  if (params.initials) {
    where.initials = { contains: normalizeText(params.initials) };
  }

  if (params.itmsGrpNam) {
    where.itmsGrpNam = { contains: normalizeText(params.itmsGrpNam) };
  }

  if (params.isActive !== undefined) {
    where.isActive = params.isActive;
  }

  const [data, total] = await Promise.all([
    prisma.itemClass.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { itmsGrpCod: "asc" },
    }),
    prisma.itemClass.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;

  return {
    source: "staging",
    filters: {
      search: params.search,
      itmsGrpCod: params.itmsGrpCod,
      initials: params.initials,
      itmsGrpNam: params.itmsGrpNam,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: data.length,
    data: data.map((row: any) => ({
      ...row,
      itmsGrpCod: row.itmsGrpCod,
      initials: row.initials,
      itmsGrpNam: row.itmsGrpNam,
      isActive: row.isActive,
    })),
  };
};

const buildSapWhereClause = (params: Partial<PaginationParams>) => {
  const clauses: string[] = ["1=1"];
  const bindings: Array<{ name: string; value: string | number }> = [];

  if (params.search) {
    clauses.push("(CAST(ItmsGrpCod AS NVARCHAR(50)) LIKE @search OR UPPER(ISNULL(U_Initials, '')) LIKE @search OR UPPER(ItmsGrpNam) LIKE @search)");
    bindings.push({ name: "search", value: `%${normalizeText(params.search)}%` });
  }

  if (params.itmsGrpCod) {
    clauses.push("CAST(ItmsGrpCod AS NVARCHAR(50)) LIKE @itmsGrpCod");
    bindings.push({ name: "itmsGrpCod", value: `%${normalizeText(params.itmsGrpCod)}%` });
  }

  if (params.initials) {
    clauses.push("UPPER(ISNULL(U_Initials, '')) LIKE @initials");
    bindings.push({ name: "initials", value: `%${normalizeText(params.initials)}%` });
  }

  if (params.itmsGrpNam) {
    clauses.push("UPPER(ItmsGrpNam) LIKE @itmsGrpNam");
    bindings.push({ name: "itmsGrpNam", value: `%${normalizeText(params.itmsGrpNam)}%` });
  }

  return {
    whereClause: clauses.join(" AND "),
    bindings,
  };
};

export const getItemClassFromSap = async (
  params: Partial<PaginationParams>,
): Promise<GetItemClassResponse> => {
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
    SELECT COUNT(*) as total
    FROM OITB
    WHERE ${whereClause}
  `);

  const total = countResult.recordset[0]?.total || 0;

  const dataRequest = pool.request();
  for (const binding of bindings) {
    dataRequest.input(binding.name, binding.value);
  }

  const dataResult = await dataRequest.query<{
    ItmsGrpCod: string;
    Initials: string;
    ItmsGrpNam: string;
  }>(`
    SELECT
      CAST(ItmsGrpCod AS NVARCHAR(50)) AS ItmsGrpCod,
      UPPER(ISNULL(U_Initials, ''))    AS Initials,
      UPPER(ItmsGrpNam)                AS ItmsGrpNam
    FROM OITB
    WHERE ${whereClause}
    ORDER BY ItmsGrpCod ASC
    OFFSET ${offset} ROWS
    FETCH NEXT ${limit} ROWS ONLY
  `);

  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;

  return {
    source: "sap",
    filters: {
      search: params.search,
      itmsGrpCod: params.itmsGrpCod,
      initials: params.initials,
      itmsGrpNam: params.itmsGrpNam,
      isActive: params.isActive,
    },
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    count: dataResult.recordset.length,
    data: dataResult.recordset.map((row: any) => ({
      itmsGrpCod: String(row.ItmsGrpCod),
      initials: row.Initials ?? "",
      itmsGrpNam: row.ItmsGrpNam,
      isActive: true,
    })),
  };
};

const parseSharePointActive = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "active";
  }

  return true;
};

export const getItemClassFromSharePoint = async (
  params: Partial<PaginationParams>,
): Promise<GetItemClassResponse> => {
  const page = normalizePage(params.page);
  const limit = normalizeLimit(params.limit);

  const allItems = await cachedDataRead('sharepoint:item-class', async () => {
    const token = await getAccessToken();
  
    const allItems: ItemClassData[] = [];
    let nextLink: string | undefined = `https://graph.microsoft.com/v1.0/sites/${env.sharePoint.itemClassSiteId}/lists/${env.sharePoint.itemClassListId}/items?$expand=fields&$top=100`;
  
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
          itmsGrpCod: String(item.fields?.ItemClass_ID || "").trim().toUpperCase(),
          initials: String(item.fields?.Code || "").trim().toUpperCase(),
          itmsGrpNam: String(item.fields?.Description || "").trim().toUpperCase(),
          isActive: parseSharePointActive(item.fields?.isActive ?? item.fields?.IsActive),
        })),
      );
  
      nextLink = data["@odata.nextLink"];
    }
  
    return allItems;
  });

  let filtered = allItems;

  if (params.search) {
    const searchTerm = normalizeText(params.search);
    filtered = filtered.filter(
      (item) =>
        matchesText(item.itmsGrpCod, searchTerm) ||
        matchesText(item.initials, searchTerm) ||
        matchesText(item.itmsGrpNam, searchTerm),
    );
  }

  if (params.itmsGrpCod) {
    filtered = filtered.filter((item) => matchesText(item.itmsGrpCod, params.itmsGrpCod!));
  }

  if (params.initials) {
    filtered = filtered.filter((item) => matchesText(item.initials, params.initials!));
  }

  if (params.itmsGrpNam) {
    filtered = filtered.filter((item) => matchesText(item.itmsGrpNam, params.itmsGrpNam!));
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
      itmsGrpCod: params.itmsGrpCod,
      initials: params.initials,
      itmsGrpNam: params.itmsGrpNam,
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
