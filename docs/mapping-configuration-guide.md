# SharePoint mapping guide and Item Master adaptation

This guide describes the current repository implementation. Changing a mapping does not change database schemas or read screens.

## Configure staging to SharePoint

1. Open **Mappings > SharePoint Mapping** (`/sharepoint-mapping`) and select the intended mapping ID.
2. Under **Source & destination**, select the staging table, SharePoint site and list. Refresh columns after schema changes.
3. Choose the source record key and destination matching field. For Items these are commonly `ItemCode`; use the actual discovered names. The source key selects records; the destination key determines insert versus update.
4. Map source fields to SharePoint internal field names. Display labels can differ from internal names.
5. Choose transformations, write modes and optional equality filters.
6. **Validate & preview** and inspect every sampled row for an `error`. Top-level `valid: true` can coexist with row errors.
7. Enable **Use saved mapping for sync**, then **Save mapping**. The switch takes effect only after a successful save. Failed activation leaves the previously saved configuration in effect.
8. Test a selected record through the existing sync screen, or use **Run saved mapping** for all eligible rows. Inspect audit values and refresh the destination.

Preview reads up to five records and writes no destination records. Saving persists configuration, not business records. Sync uses saved settings, never unsaved edits. Original mapping IDs, such as `item`, drive existing sync buttons; custom mappings run through their own **Run saved mapping** action. Disabled/absent original mappings let those buttons use built-in handlers.

## Field rules and write modes

| Rule | Purpose |
|---|---|
| Copy value | Retains a value subject to destination type validation |
| Uppercase/lowercase/trim | Normalizes text |
| Number | Converts numeric text or other supported numeric input to a JavaScript number |
| Boolean | Converts supported flags such as Y/N to true/false |
| Fixed value | Uses a configured scalar instead of a source column |
| UUID | Generates a UUID; cannot be the matching-key rule |
| Value rules | Maps specific inputs to configured outputs, such as Y to ACTIVE |
| Table lookup | Matches an input in another SQL table and returns a column |

Use **Create & update** for normal synchronized values, **Create only** for initial values, and **Update only** where creates already have an appropriate value/default. Required fields without defaults need create mappings. The matching key must be mapped for both creates and updates and cannot use a constant or generated UUID.

Each field has one transformation, not a transformation chain. A lookup returns its configured result directly. Choose a numeric result column for numeric destinations rather than assuming a Number rule runs after the lookup.

## SQL Decimal to SharePoint Number

The staging column can remain `decimal(18,6)`. The SharePoint destination uses Number or Currency, not a separate Decimal type in this editor.

Prisma reads SQL decimals as Decimal objects. The SharePoint payload builder now converts these objects to JavaScript numbers for Number/Currency destinations, including values returned by Copy or lookup rules:

```text
SQL ConvertionValue = 24.500001
Prisma Decimal object
SharePoint JSON: { "ConvertionValue": 24.500001 }
```

Zero remains zero; optional null remains null. There is no deliberate integer rounding. JavaScript numbers have finite precision, so this conversion is not an arbitrary-precision decimal transport. Numeric strings still require the Number rule; non-finite numbers are rejected. SharePoint display formatting is separate from the numeric payload.

For Items, map SQL `ConvertionValue` to the actual SharePoint internal field `ConvertionValue` using Copy when the source is SQL Decimal. Preserve the existing spelling. The running API must have loaded the Decimal conversion fix.

## Table lookups: source, match, return

```text
Source field value -> lookup table match column -> return column
```

| Setting | Example |
|---|---|
| Source | UOM code, such as BOX |
| Lookup database | Local |
| Lookup table | dbo.Uoms |
| Match column | UomCode |
| Return column | Id |
| Output | Local numeric ID for BOX |

Equivalent read: `SELECT Id FROM dbo.Uoms WHERE UomCode = 'BOX'`.

Do not pass SAP numeric IDs into a match on `UomCode`. IDs are independent between databases. In the verified data, SAP PC had ID 1, while local PC had ID 14 and local ID 1 represented BAG. Match using the code and save the returned local ID.

Keys trim whitespace and ignore case. Missing matches fail by default. **Send empty (null)** is suitable only if an absent reference is valid and the destination accepts null. Multiple different results for the same normalized match key are rejected as ambiguous.

Choose **Item Master** as the lookup database when the reference lives there. The existing conversion example uses `ItemCode -> dbo.items.number -> items_per_purchase_unit`. Verify table/column names through discovery in each environment. A SQL table lookup returns a scalar; it does not write native SharePoint lookup columns.

## Item example: two separate mappings

SAP SQL aliases and physical staging column names belong to different sync steps.

| SAP query source | Staging destination | Rule |
|---|---|---|
| PurchaseUOMCode | UOM | Copy |
| PurchaseUOMCode | UOM_ID | Local dbo.Uoms: match UomCode, return Id |
| InventoryUOM | InventoryOUM | Copy |
| ItemCode | ConvertionValue | Item Master dbo.items: match number, return items_per_purchase_unit |

Editing SAP SQL does not automatically remap field rules. For SAP Item mappings, UOM and UOM_ID must identify the same local UOM on create and update.

| Physical staging source | SharePoint destination | Rule |
|---|---|---|
| ItemCode | Actual item-code internal field | Copy or uppercase |
| UOM | Actual purchase-UOM/code internal field | Copy |
| InventoryOUM | InventoryUOM, if that internal field exists | Copy |
| ConvertionValue | ConvertionValue, if that internal field exists | Copy for SQL Decimal |

If the list uses `UOM_code` for the purchase code, map staging UOM there. Do not assume a SharePoint `PurchaseUOM` field exists. Only map IDs where the destination expects that ID namespace.

## Adapt this workflow to Item Master to staging

Open **Mappings > Item Master > Staging Mapping** (`/itemmaster-mapping`). Reuse the field rules, write modes, filters, lookup database selector, preview, saved activation and history workflow.

| Concern | Staging to SharePoint | Item Master to staging |
|---|---|---|
| Source | Local staging table | Item Master table or compatibility preset |
| Destination | SharePoint site/list | Discovered staging table |
| Destination types | Graph scalar field types | SQL scalar column types |
| Configuration provider | sharepoint | itemmaster-staging |
| Original sync mapping ID | Module-specific, such as item | item-group |

Create a separate Item Master mapping. Do not import SharePoint JSON unchanged: replace source selections and site/list destination settings with the selected Item Master source and staging table/key. Remap fields from discovered columns. Physical Item Master sources expose actual table columns without implicit joins or normalization. This editor has no custom SQL source editor.

The SharePoint Decimal fix is in `buildPayload`. Item Master uses `buildStagingPayload`, which still requires JavaScript numbers for numeric SQL destinations. Use the **Number** rule for numeric strings or Decimal objects when needed there and validate actual samples. Integer destinations enforce integer ranges; decimal destinations also retain SQL precision/scale constraints. Do not assume SharePoint-specific Decimal handling was added to Item Master execution.

Existing Item Master sync buttons use the original `item-group` mapping ID. A custom mapping targeting Items runs through its own **Run saved mapping** action; it does not replace SAP Item sync. See the [Item Master reference](itemmaster-staging-mapping.md) for source presets, APIs and limits.

## Troubleshooting and audits

| Symptom | Check |
|---|---|
| Lookup not found for UOM_ID: 1 | Numeric source passed into a code lookup |
| Lookup not found for Piece | Name/code mismatch: PIECE is a name, PC is a code |
| Requires a number | Destination type, source runtime type, transformation and running API version |
| valid: true with row errors | Inspect every rows[].error; schema success does not mean row success |
| Success but values remain null | Saved enabled status, intended mapping ID, source values and recorded audit payload |
| HTTP 409 during save | Reload the current version before saving again |
| Failure before counts/audit exist | Preflight can fail before creating an audit run; inspect the response error |

Execution preflights all eligible rows, not only the preview samples. Invalid later rows, duplicate keys or failed lookups can block all writes. After preflight, per-record write failures can still produce partial success.

Configured runs record a MAPPING message identifying mapping/version, plus inserted values or changes. Built-in Item sync records FETCH and a fixed payload with its own fields. Check those records rather than relying only on the Success badge. SharePoint execution creates missing records, patches changed fields, skips unchanged records and never deletes records.

## Backend and API reference

- `src/modules/mappings/domain.ts`: transformations, lookup normalization and SharePoint payload/Decimal validation.
- `src/modules/mappings/metadata.ts`: SQL/Graph discovery, SQL reads and lookup loading.
- `src/modules/mappings/service.ts`: SharePoint preview, preflight, execution and audit.
- `src/modules/mappings/routes.ts`: configuration endpoints and enabled-mapping routing.
- `src/modules/mappings/store.ts`: provider-isolated saved configurations and version history.
- `src/modules/mappings/staging-domain.ts`: SQL destination validation and payload construction.
- `src/modules/mappings/itemmaster/`: Item Master source and execution logic.

SharePoint configuration prefix: `/api/mappings/sharepoint`.

| Endpoint | Request |
|---|---|
| POST /preview | `{ "config": ... }` |
| PUT /:module | `{ "config": ..., "enabled": true, "version": <current version> }` |
| POST /:module/run | `{ "confirm": true }` |

Export the actual saved configuration for a full environment-specific JSON example. See the [SharePoint reference](sharepoint-mapping.md) and [SAP reference](sap-staging-mapping.md) for deployment, permissions and endpoint details.
