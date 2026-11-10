import sql, { ConnectionPool } from "mssql";
import { env } from "../config/env";

const itemMasterConfig: sql.config = {
  server: env.itemMasterDb.server,
  user: env.itemMasterDb.user,
  password: env.itemMasterDb.password,
  database: env.itemMasterDb.database,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let itemMasterPool: ConnectionPool | null = null;
let pendingConnection: Promise<ConnectionPool> | null = null;

export const getItemMasterPool = async (): Promise<ConnectionPool> => {
  if (itemMasterPool && itemMasterPool.connected) {
    return itemMasterPool;
  }

  if (!pendingConnection) pendingConnection = new sql.ConnectionPool(itemMasterConfig).connect().then(pool => { itemMasterPool = pool; return pool; }).finally(() => { pendingConnection = null; });
  return pendingConnection;
};
