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

export const getSapPool = async (): Promise<ConnectionPool> => {
  if (sapPool && sapPool.connected) {
    return sapPool;
  }

  sapPool = await new sql.ConnectionPool(sapConfig).connect();
  return sapPool;
};
