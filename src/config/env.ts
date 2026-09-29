import dotenv from "dotenv";

dotenv.config();

const {
  NODE_ENV = "development",
  PORT = "3000",
  DATABASE_URL = "",
  JWT_SECRET = "",
  SAP_DB_SERVER = "",
  SAP_DB_USER = "",
  SAP_DB_PASSWORD = "",
  SAP_DB_NAME = "",
  ITEMMASTER_DB_SERVER = "",
  ITEMMASTER_DB_USER = "",
  ITEMMASTER_DB_PASSWORD = "",
  ITEMMASTER_DB_NAME = "",
  SP_TENANT_ID = "",
  SP_CLIENT_ID = "",
  SP_CLIENT_SECRET = "",
  SP_WH_SITE_ID = "",
  SP_WH_LIST_ID = "",
  SP_IC_SITE_ID = "",
  SP_IC_LIST_ID = "",
  SP_IG_SITE_ID = "",
  SP_IG_LIST_ID = "",
  SP_IM_SITE_ID = "",
  SP_IM_LIST_ID = "",
  SP_UOM_SITE_ID = "",
  SP_UOM_LIST_ID = "",
} = process.env;

if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL in environment variables.");
}

if (!JWT_SECRET) {
  throw new Error("Missing JWT_SECRET in environment variables.");
}

if (!SAP_DB_SERVER || !SAP_DB_USER || !SAP_DB_PASSWORD || !SAP_DB_NAME) {
  throw new Error("Missing SAP_DB_* environment variables.");
}

export const env = {
  nodeEnv: NODE_ENV,
  port: Number(PORT),
  databaseUrl: DATABASE_URL,
  jwtSecret: JWT_SECRET,
  sapDb: {
    server: SAP_DB_SERVER,
    user: SAP_DB_USER,
    password: SAP_DB_PASSWORD,
    database: SAP_DB_NAME,
  },
  itemMasterDb: {
    server: ITEMMASTER_DB_SERVER,
    user: ITEMMASTER_DB_USER,
    password: ITEMMASTER_DB_PASSWORD,
    database: ITEMMASTER_DB_NAME,
  },
  sharePoint: {
    tenantId: SP_TENANT_ID,
    clientId: SP_CLIENT_ID,
    clientSecret: SP_CLIENT_SECRET,
    warehouseSiteId: SP_WH_SITE_ID,
    warehouseListId: SP_WH_LIST_ID,
    itemClassSiteId: SP_IC_SITE_ID,
    itemClassListId: SP_IC_LIST_ID,
    itemGroupSiteId: SP_IG_SITE_ID,
    itemGroupListId: SP_IG_LIST_ID,
    itemSiteId: SP_IM_SITE_ID,
    itemListId: SP_IM_LIST_ID,
    uomSiteId: SP_UOM_SITE_ID,
    uomListId: SP_UOM_LIST_ID,
    spTenantId: SP_TENANT_ID,
    spClientId: SP_CLIENT_ID,
    spClientSecret: SP_CLIENT_SECRET,
    whSiteId: SP_WH_SITE_ID,
    whListId: SP_WH_LIST_ID,
    icSiteId: SP_IC_SITE_ID,
    icListId: SP_IC_LIST_ID,
    igSiteId: SP_IG_SITE_ID,
    igListId: SP_IG_LIST_ID,
    imSiteId: SP_IM_SITE_ID,
    imListId: SP_IM_LIST_ID,
    spUomSiteId: SP_UOM_SITE_ID,
    spUomListId: SP_UOM_LIST_ID,
  },
};
