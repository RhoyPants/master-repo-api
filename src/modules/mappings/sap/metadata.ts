import { stagingTableColumns } from "../staging-metadata";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { SourceColumn, normalizedKey } from "../domain";
import { loadLookups } from "../metadata";
import { describeSapQuery, executeSapQuery } from "./query";
import { fetchSapWarehouses, fetchSapWarehousesByCodes } from "../../sync/sap-staging/warehouse/service";
import { fetchSapItemClasses, fetchSapItemClassByCodes } from "../../sync/sap-staging/item-class/service";
import { fetchSapUoms, fetchSapUomsByCodes } from "../../sync/sap-staging/uom/service";
import { buildItemReferenceMaps, resolveItemReferences, normalizeSapFlag, fetchSAPItemsFromOITM, fetchSAPItemsByCodes } from "../../sync/sap-staging/item/service";
import { SapMappingConfig, SapModule, StagingColumn, sapModule, sapModules, sapConfigModule } from "./domain";

export const identifier = (value: string) => `[${value.replace(/]/g, "]]")}]`;
export const tableSql = (module: SapModule) => Prisma.raw(sapModules[module].table.split(".").map(identifier).join("."));
export function sapSourceColumns(module: SapModule): SourceColumn[] {
  const fields: Array<[string, string]> = module === "warehouse" ? [["WhCode", "text"], ["WhName", "text"], ["Address", "text"], ["Inactive", "text"], ["ResolvedIsActive", "boolean"]]
    : module === "item-class" ? [["ItmsGrpCod", "text"], ["Initials", "text"], ["ItmsGrpNam", "text"]]
    : module === "uom" ? [["UomCode", "text"], ["UomName", "text"]]
    : [
      ...["ItemCode", "ItemDescription", "validFor", "Category", "itemClassCode", "itemClassName", "UOM", "ItemGroupName", "ResolvedItemClassCode", "ResolvedUomCode"].map(name => [name, "text"] as [string, string]),
      ...["UOM_ID", "LeadTime", "ResolvedUomId", "ResolvedLeadTime"].map(name => [name, "number"] as [string, string]),
      ...["iswhInventory", "isSalesInventory", "isPurchaseInventory"].map(name => [name, "SAP flag"] as [string, string]),
      ...["NormalizedWHInventory", "NormalizedSalesInventory", "NormalizedPurchaseInventory"].map(name => [name, "boolean"] as [string, string]),
    ];
  return fields.map(([name, type]) => ({ name, type, nullable: true }));
}
export const stagingColumns = (module: SapModule): Promise<StagingColumn[]> => stagingTableColumns(sapModules[module].table.split(".")[1]!);
export async function itemReferenceMaps() {
  const [classes, uoms] = await Promise.all([
    prisma.itemClass.findMany({ select: { itmsGrpCod: true, initials: true } }),
    prisma.uom.findMany({ select: { id: true, uomCode: true } }),
  ]);
  return buildItemReferenceMaps(classes, uoms);
}
export async function mappingSourceColumns(config: SapMappingConfig) {
  return config.source.query ? describeSapQuery(config.source.query) : sapSourceColumns(sapConfigModule(config));
}
export async function sapLookups(config: SapMappingConfig) {
  const special = sapConfigModule(config) === "item" ? config.fields.filter(rule => rule.transform === "lookup" &&
    (rule.lookup?.database === undefined || rule.lookup.database === "local") &&
    ((rule.lookup?.table === "dbo.ItemClasses" && rule.lookup.match === "Initials" && rule.lookup.result === "ItmsGrpCod") ||
     (rule.lookup?.table === "dbo.Uoms" && rule.lookup.match === "UomCode" && rule.lookup.result === "Id"))) : [];
  const lookups = await loadLookups({ fields: config.fields.filter(rule => !special.includes(rule)) });
  if (special.length) {
    const references = await itemReferenceMaps();
    for (const rule of special) {
      const index = new Map<string, unknown>([["", null]]);
      if (rule.lookup!.table === "dbo.ItemClasses") {
        references.itemClassInitialsToCode.forEach((code, initials) => index.set(initials, code));
        references.itemClassCodeSet.forEach(code => index.set(code, code));
        references.ambiguousItemClassInitials.forEach(initials => index.delete(initials));
      } else references.uomCodeToId.forEach((id, code) => index.set(code, id));
      lookups.set(JSON.stringify(rule.lookup), index);
    }
  }
  return lookups;
}
export async function readMappingRows(config: SapMappingConfig, codes?: string[], sample = false) {
  if (!config.source.query) return readSapRows(sapConfigModule(config), codes);
  const requestedCodes = codes ? [...new Set(codes.map(normalizedKey))] : undefined;
  const records = await executeSapQuery(config.source.query, sample && !config.source.filters.length && !codes);
  const rows = requestedCodes ? records.filter(row => requestedCodes.includes(normalizedKey(row[config.source.key])) ||
    (sapConfigModule(config) === "item-class" && requestedCodes.includes(normalizedKey(row.Initials)))) : records;
  return { rows, requestedCodes };
}
export async function readSapRows(module: SapModule, codes?: string[]) {
  const requested = codes ? [...new Set(codes.map(normalizedKey))] : undefined;
  let rows: Array<Record<string, unknown>>;
  if (module === "warehouse") {
    const records = requested ? (await fetchSapWarehousesByCodes(requested)).foundRows : await fetchSapWarehouses();
    rows = records.map(row => ({ ...row, ResolvedIsActive: row.Inactive === "N" }));
  } else if (module === "item-class") {
    const records = requested ? (await fetchSapItemClassByCodes(requested)).foundRows : await fetchSapItemClasses();
    rows = records.map(row => ({ ...row }));
  } else if (module === "uom") {
    const records = requested ? (await fetchSapUomsByCodes(requested)).foundRows : await fetchSapUoms();
    rows = records.map(row => ({ ...row, UomCode: normalizedKey(row.UomCode), UomName: normalizedKey(row.UomName) }));
  } else {
    const records = requested ? (await fetchSAPItemsByCodes(requested)).foundRows : await fetchSAPItemsFromOITM();
    const maps = await itemReferenceMaps();
    rows = records.map(row => {
      try {
        const references = resolveItemReferences(row, maps);
        return {
          ...row, ItemDescription: row.ItemDescription ?? "", Category: row.Category ?? "",
          ResolvedItemClassCode: references.resolvedItemClassCode || null, ResolvedUomId: references.resolvedUomId,
          ResolvedUomCode: references.normalizedUomCode || null, ResolvedLeadTime: row.LeadTime ?? 0,
          NormalizedWHInventory: normalizeSapFlag(row.iswhInventory), NormalizedSalesInventory: normalizeSapFlag(row.isSalesInventory),
          NormalizedPurchaseInventory: normalizeSapFlag(row.isPurchaseInventory),
        };
      } catch (error) {
        return { ...row, sourceError: error instanceof Error ? error.message : String(error) };
      }
    });
  }
  return { rows, requestedCodes: requested };
}
