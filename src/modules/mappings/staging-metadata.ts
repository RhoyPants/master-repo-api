import { prisma } from "../../lib/prisma";
import { StagingColumn } from "./staging-domain";

export async function stagingTableColumns(table: string, schema = "dbo"): Promise<StagingColumn[]> {
  const rows = await prisma.$queryRaw<Array<{
    name: string; type: string; nullable: boolean; identity: boolean; computed: boolean; hasDefault: boolean; length: number;
  }>>`
    SELECT c.name, t.name AS [type], c.is_nullable AS nullable, c.is_identity AS [identity], c.is_computed AS computed,
      CAST(CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END AS BIT) AS hasDefault, c.max_length AS [length]
    FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
    JOIN sys.tables tb ON c.object_id = tb.object_id JOIN sys.schemas s ON tb.schema_id = s.schema_id
    WHERE s.name = ${schema} AND tb.name = ${table} ORDER BY c.column_id`;
  return rows.map(row => ({
    name: row.name, type: row.type, nullable: row.nullable, hasDefault: row.hasDefault,
    readOnly: row.identity || row.computed || ["CreatedAt", "UpdatedAt"].includes(row.name),
    supported: ["nvarchar", "varchar", "nchar", "char", "uniqueidentifier", "bit", "tinyint", "smallint", "int", "float", "real", "decimal", "numeric"].includes(row.type),
    ...(row.length > 0 && ["nvarchar", "nchar", "varchar", "char"].includes(row.type) ? { maxLength: row.length / (row.type.startsWith("n") ? 2 : 1) } : {}),
  }));
}
