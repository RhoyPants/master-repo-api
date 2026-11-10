import sql, { ConnectionPool } from "mssql";
import { env } from "../config/env";

const sapConfig: sql.config = {
  server: env.sapDb.server,
  user: env.sapDb.user,
  password: env.sapDb.password,
  database: env.sapDb.database,
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

let sapPool: ConnectionPool | null = null;
let pendingConnection: Promise<ConnectionPool> | null = null;

export const getSapPool = async (): Promise<ConnectionPool> => {
  if (sapPool && sapPool.connected) {
    return sapPool;
  }

  if (!pendingConnection) pendingConnection = new sql.ConnectionPool(sapConfig).connect().then(pool => { sapPool = pool; return pool; }).finally(() => { pendingConnection = null; });
  return pendingConnection;
};

let queryPool: Promise<ConnectionPool> | null = null;
export const getSapQueryPool = (): Promise<ConnectionPool> => {
  if (!queryPool) {
    queryPool = new sql.ConnectionPool({
      ...sapConfig,
      requestTimeout: 15000,
      options: { ...sapConfig.options, readOnlyIntent: true },
      pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
    }).connect().catch(error => { queryPool = null; throw error; });
  }
  return queryPool;
};
