import { prisma } from "../../lib/prisma";
import { MappingBase, MappingError, parseConfig } from "./domain";

type Stored = { Id: number; Provider: string; Module: string; ConfigJson: string; Enabled: boolean; Version: number; UpdatedBy: string; UpdatedAt: Date };
export function createMappingStore<T extends MappingBase>(provider: "sharepoint" | "sap-staging" | "itemmaster-staging", parse: (input: unknown) => T) {
  const unpack = (row: Stored) => ({ id: row.Id, provider: row.Provider, module: row.Module,
    config: parse(JSON.parse(row.ConfigJson)), enabled: row.Enabled, version: row.Version, updatedBy: row.UpdatedBy, updatedAt: row.UpdatedAt });
  async function savedMappings() {
    const rows = await prisma.$queryRaw<Stored[]>`SELECT * FROM dbo.IntegrationMappings WHERE Provider = ${provider} ORDER BY Module`;
    return rows.map(unpack);
  }
  async function savedMapping(module: string) {
    const rows = await prisma.$queryRaw<Stored[]>`SELECT * FROM dbo.IntegrationMappings WHERE Provider = ${provider} AND Module = ${module}`;
    return rows[0] ? unpack(rows[0]) : null;
  }
  async function mappingHistory(module: string, beforeVersion?: number) {
    const before = beforeVersion ?? 2147483647;
    const rows = await prisma.$queryRaw<Array<Pick<Stored, "Version" | "Enabled" | "UpdatedBy" | "UpdatedAt">>>`
      SELECT TOP (21) Version, Enabled, UpdatedBy, UpdatedAt FROM dbo.IntegrationMappingVersions
      WHERE Provider = ${provider} AND Module = ${module} AND Version < ${before}
      ORDER BY Version DESC`;
    const versions = rows.slice(0, 20).map(row => ({
      version: row.Version, enabled: row.Enabled, updatedBy: row.UpdatedBy, updatedAt: row.UpdatedAt,
    }));
    return { versions, nextBeforeVersion: rows.length > 20 ? versions[versions.length - 1]!.version : null };
  }
  async function mappingVersion(module: string, version: number) {
    const rows = await prisma.$queryRaw<Stored[]>`
      SELECT * FROM dbo.IntegrationMappingVersions
      WHERE Provider = ${provider} AND Module = ${module} AND Version = ${version}`;
    if (!rows[0]) throw new MappingError("This mapping version is not available. Versions overwritten before history was installed cannot be recovered here.", 404);
    return unpack(rows[0]);
  }
  async function saveMapping(config: T, enabled: boolean, version: number, actor: string) {
    const json = JSON.stringify(config);
    try {
      return await prisma.$transaction(async tx => {
        if (version === 0) {
          await tx.$executeRaw`INSERT INTO dbo.IntegrationMappings (Provider, Module, ConfigJson, Enabled, Version, UpdatedBy)
            VALUES (${provider}, ${config.module}, ${json}, ${enabled}, 1, ${actor})`;
        } else {
          const changed = await tx.$executeRaw`UPDATE dbo.IntegrationMappings
            SET ConfigJson = ${json}, Enabled = ${enabled}, Version = Version + 1, UpdatedBy = ${actor}, UpdatedAt = CURRENT_TIMESTAMP
            WHERE Provider = ${provider} AND Module = ${config.module} AND Version = ${version}`;
          if (changed !== 1) throw new MappingError("This mapping changed in another session. Reload before saving.", 409);
        }
        await tx.$executeRaw`INSERT INTO dbo.IntegrationMappingVersions (Provider, Module, ConfigJson, Enabled, Version, UpdatedBy, UpdatedAt)
          SELECT Provider, Module, ConfigJson, Enabled, Version, UpdatedBy, UpdatedAt
          FROM dbo.IntegrationMappings WHERE Provider = ${provider} AND Module = ${config.module}`;
        const rows = await tx.$queryRaw<Stored[]>`SELECT * FROM dbo.IntegrationMappings WHERE Provider = ${provider} AND Module = ${config.module}`;
        if (!rows[0]) throw new MappingError("Saved mapping could not be read.", 500);
        return unpack(rows[0]);
      });
    } catch (error) {
      if (error instanceof MappingError) throw error;
      const e = error as { meta?: { code?: string } };
      if (["2601", "2627"].includes(e.meta?.code ?? "")) throw new MappingError("A mapping for this module already exists. Reload before saving.", 409);
      throw error;
    }
  }
  return { unpack, savedMappings, savedMapping, mappingHistory, mappingVersion, saveMapping };
}

export const { unpack, savedMappings, savedMapping, mappingHistory, mappingVersion, saveMapping } = createMappingStore("sharepoint", parseConfig);
