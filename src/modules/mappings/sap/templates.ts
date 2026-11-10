export const sapQueries = {
  warehouse: `SELECT
  UPPER(WhsCode) AS WhCode,
  UPPER(WhsName) AS WhName,
  UPPER(StreetNo) AS Address,
  Inactive,
  CAST(CASE WHEN Inactive = 'N' THEN 1 ELSE 0 END AS BIT) AS ResolvedIsActive
FROM OWHS`,
  "item-class": `SELECT
  CAST(ItmsGrpCod AS NVARCHAR(50)) AS ItmsGrpCod,
  UPPER(U_Initials) AS Initials,
  UPPER(ItmsGrpNam) AS ItmsGrpNam
FROM OITB
WHERE U_Initials IS NOT NULL`,
  uom: `SELECT
  UPPER(LTRIM(RTRIM(UomCode))) AS UomCode,
  UPPER(LTRIM(RTRIM(UomName))) AS UomName
FROM OUOM`,
  item: `SELECT
  UPPER(itm.ItemCode) AS ItemCode,
  ISNULL(UPPER(itm.ItemName), '') AS ItemDescription,
  itm.validFor AS validFor,
  ISNULL(UPPER(itm.ItemType), '') AS Category,
  grp.U_Initials AS itemClassCode,
  UPPER(grp.ItmsGrpNam) AS itemClassName,
  UPPER(uom.UomCode) AS UOM,
  uom.UomEntry AS UOM_ID,
  ISNULL(itm.LeadTime, 0) AS ResolvedLeadTime,
  CAST(CASE WHEN UPPER(LTRIM(RTRIM(itm.ByWh))) IN ('Y', 'YES', 'TRUE', '1') THEN 1 ELSE 0 END AS BIT) AS NormalizedWHInventory,
  CAST(CASE WHEN UPPER(LTRIM(RTRIM(itm.SellItem))) IN ('Y', 'YES', 'TRUE', '1') THEN 1 ELSE 0 END AS BIT) AS NormalizedSalesInventory,
  CAST(CASE WHEN UPPER(LTRIM(RTRIM(itm.PrchseItem))) IN ('Y', 'YES', 'TRUE', '1') THEN 1 ELSE 0 END AS BIT) AS NormalizedPurchaseInventory,
  UPPER(itm.U_ItemClass) AS ItemGroupName
FROM OITM itm
LEFT JOIN OITB grp ON itm.ItmsGrpCod = grp.ItmsGrpCod
LEFT JOIN OUOM uom ON itm.InvntryUom = uom.UomName OR itm.InvntryUom = uom.UomCode
WHERE itm.validFor = 'Y' AND itm.CreateDate >= '2026-04-22 00:00:00.000'
ORDER BY itm.ItemCode`,
};
