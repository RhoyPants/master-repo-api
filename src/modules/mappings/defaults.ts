import { env } from "../../config/env";
import { FieldRule, MappingConfig } from "./domain";

export function defaultMappings(): MappingConfig[] {
  const sp = env.sharePoint;
  const field = (source: string, target: string, transform: FieldRule["transform"] = "copy"): FieldRule => ({ source, target, transform });
  const constant = (target: string, value: string | number): FieldRule => ({ source: "", target, transform: "constant", value });
  const title: FieldRule = { source: "", target: "Title", transform: "uuid", write: "create" };
  const base = (module: string, table: string, key: string, siteId: string, listId: string, destinationKey: string, fields: FieldRule[], filters: MappingConfig["source"]["filters"] = []): MappingConfig => ({
    schemaVersion: 1, module, name: `${module} → SharePoint`, source: { table: `dbo.${table}`, key, filters },
    destination: { siteId, listId, key: destinationKey }, fields: [title, ...fields],
  });
  return [
    base("warehouse", "Warehouses", "WhCode", sp.warehouseSiteId, sp.warehouseListId, "wh_code", [
      field("WhCode", "wh_code", "uppercase"), field("WhName", "wh_name", "uppercase"), field("Address", "wh_address", "uppercase"), field("IsActive", "isActive", "number"),
    ]),
    base("item-class", "ItemClasses", "ItmsGrpCod", sp.itemClassSiteId, sp.itemClassListId, "Code", [
      field("Initials", "Code", "uppercase"), field("ItmsGrpNam", "Description", "uppercase"), field("ItmsGrpCod", "ItemClass_ID", "number"), constant("Entity", "GVI"),
    ]),
    base("item-group", "ItemGroups", "ItemGroupID", sp.itemGroupSiteId, sp.itemGroupListId, "ItemGroupID", [
      field("ItemGroupID", "ItemGroupID", "number"), field("Initials", "Code"), field("Name", "Description"), field("ItemClassCode", "ItemClassCode"), field("ItemClass", "ItemClass"), field("Category", "Category"),
    ]),
    base("uom", "Uoms", "UomCode", sp.uomSiteId, sp.uomListId, "ShortDescription", [
      field("UomCode", "ShortDescription", "uppercase"), field("UomName", "Description", "uppercase"), constant("Entity", "HULMA"),
    ]),
    base("item", "Items", "ItemCode", sp.itemSiteId, sp.itemListId, "ItemCode", [
      field("ItemCode", "ItemCode", "uppercase"), field("ItemDescription", "ItemDescription", "uppercase"), field("Category", "Category", "uppercase"),
      { source: "IsActive", target: "Status", transform: "valueMap", values: { true: "ACTIVE", false: "INACTIVE", "1": "ACTIVE", "0": "INACTIVE" } },
      constant("Entity", "GVI"), field("LeadTime", "LeadTime", "number"), field("IsWHInventory", "iswhInventory", "number"),
      { source: "ItemClassCode", target: "itemClassCode", transform: "lookup", lookup: { table: "dbo.ItemClasses", match: "ItmsGrpCod", result: "Initials" } },
      { source: "ItemGroupName", target: "itemGroupCode", transform: "lookup", lookup: { table: "dbo.ItemGroups", match: "Name", result: "Initials" }, onMissing: "null" },
      field("UOM", "UOM_code", "uppercase"), { ...constant("isModified", 0), write: "create" }, { ...constant("isModified", 1), write: "update" },
    ], [{ column: "IsActive", value: true }]),
  ];
}
