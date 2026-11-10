# SAP to staging mappings

Open **Mappings → SAP → Staging Mapping** (`/sap-mapping`). This release supports only the existing `warehouse`, `item-class`, `uom`, and `item` modules. Staging destination tables and destination matching keys are fixed. The source is an editable, read-only SAP SELECT query; its output columns/aliases populate the mapping dropdowns.

The shared mapping editor includes source/destination details, field rules, create/update write modes, staging-table lookups, equality filters, JSON import/export, read-only preview and save-result modals, and readable version history. Primary actions remain sticky while the page scrolls. Add fields below the full-height field table. Technical JSON tools and history are under **More actions**.

Saving persists configuration only. Save with **Use saved mapping for sync** enabled to run that snapshot. For original mapping IDs, existing sync buttons use that saved configuration. Custom IDs run through their own **Run saved mapping** action. Viewing old versions does not restore them, discard unsaved edits, or run a sync.

## Add independent mappings

Click **New mapping**, enter a unique **New mapping ID** and **New mapping name**, and choose a **Template module** (warehouse, item-class, uom or item). **Create draft** copies that module's default SQL and field rules into an unsaved, disabled mapping. Edit the query, test its output columns, preview and save as usual. The template retains its destination table, key and module-specific reference rules. Custom IDs do not bypass Item/UOM validation or Item Class business rules.

The **Mapping** selector lists original templates and saved custom mappings. IDs use lowercase letters, numbers and hyphens, up to 50 characters; existing IDs cannot be reused. Each ID has independent configuration, enable status, version sequence and read-only history. Changing one does not overwrite another. Draft creation does not save configuration or run a sync; switching away from unsaved edits requires discarding them.

For example, `uom-branch-a` and `uom-branch-b` can both use the uom template with different SQL/filters. Save and enable each, then use its **Run saved mapping** action. Multiple custom mappings may be enabled simultaneously. Existing `/sync/sap-staging/uom/...` buttons always resolve the original `uom` mapping ID; they never pick the newest custom mapping or run all enabled mappings. If the original is absent/disabled, those buttons retain built-in behavior. Original IDs cannot be reassigned to a different template module.

In JSON, `module` remains the unique mapping ID used by storage/API URLs; custom SAP mappings include `syncModule` identifying their template module. Old snapshots without `syncModule` resolve their original module as before. History/version/manual-run URLs accept custom IDs: `/:mappingId/history`, `/:mappingId/history/:version`, and `/:mappingId/run`. Metadata/test-query requests still use the template module. Results include `mappingId`, and audits record mapping identity and version. Mappings writing the same module's destination are serialized within one API process. Storage still uses the existing provider + Module uniqueness; no migration is required.

## Query workflow

1. Paste/edit **SAP SQL query**. Start from the default query if needed.
2. **Test query** checks actual SQL Server result metadata and displays output names/types plus up to five source records in a modal. It neither saves configuration nor writes staging data. Named output columns remain available even when there are no rows.
3. Select **Source record key** from the query output and map that same column to the fixed staging matching key. Pair other output columns with staging fields. Use unique `AS` aliases for computed expressions and duplicate column names from joins.
4. **Validate & preview** additionally checks field rules, staging types and references.
5. **Save mapping** stores the original query text, field mappings, filters and enabled flag together as a new immutable version. Unsaved SQL never replaces a saved sync configuration.

Editing the query invalidates loaded source columns; Test query or Refresh query & staging columns must reload them. Removed/renamed aliases do not silently rewrite existing field rules: remap missing fields explicitly. Enabling additionally previews the query; execution preflights every eligible row.

Queries support one SELECT, including supported CTEs, joins, aggregates and computed expressions. SQL is parsed as Transact-SQL and the validated AST is rendered for execution, not concatenated into staging SQL. SQL Server result metadata, not a SELECT-text split, drives columns. Writes, SELECT INTO, multiple statements, variables/assignments, external or qualified custom functions, temporary tables, linked servers and cross-database sources are rejected. Unsupported parser syntax/functions return explicit errors. Tables/views must be accessible in the connected SAP database.

## Default source/business rules

New templates include editable SQL preserving the original source eligibility and normalizations. Previously saved snapshots without `source.query` still call their original built-in read functions and keep their old field mappings; loading a default query creates unsaved edits, not a migration or activation.

| Module | SAP source | Staging destination | Matching key |
|---|---|---|---|
| Warehouse | OWHS query aliases | dbo.Warehouses | WhCode |
| Item Class | OITB query aliases | dbo.ItemClasses | ItmsGrpCod |
| UOM | OUOM query aliases | dbo.Uoms | UomCode |
| Item | OITM with existing OITB/OUOM joins | dbo.Items | ItemCode |

- Warehouse codes, names and addresses retain the existing uppercase query behavior. `ResolvedIsActive` preserves `Inactive === "N"`.
- Item Class retains `U_Initials IS NOT NULL`; selected runs accept either codes or initials. As in the existing service, an IsActive-only difference does not trigger an update, but a changed record receives mapped IsActive.
- UOM retains uppercase/trim normalization.
- The Item default query retains `validFor = 'Y'` and `CreateDate >= '2026-04-22'`, plus the existing joins. Normalized inventory flags and null description/category defaults retain the built-in behavior. Default Item mappings use staging lookups for Item Class and UOM ID, not the SAP UomEntry returned as source UOM_ID. The ItemClasses/Initials/ItmsGrpCod lookup preserves existing-code preference and rejects ambiguous initials when used; empty class/UOM references resolve to null. Map UOM and UOM_ID together with matching write modes; preview and execution reject mismatched staging UOM pairs.
- Custom query edits can intentionally change eligibility and joins; the editor warns about this. Source filters further narrow query results. Only actual query output names appear in query-source dropdowns.
- Created/updated timestamp columns are managed automatically and cannot be mapped. Item inserts retain UpdatedAt initialization; existing unchanged records are skipped without changing timestamps. Matching keys are not renamed during updates.

## Execution and history

Enabled mappings intercept the existing `/sync/sap-staging/{module}/run`, `/run/single`, and `/run/multiple` URLs. Existing per-module count/item response fields and the Item response envelope remain available. **Run saved mapping** executes all eligible rows after confirmation.

Module sync screens keep a blocking **Sync in progress** modal with a spinner visible throughout the request and follow-up data refresh. Confirmation/cancellation and dismissal are disabled while pending; the existing result modal appears on success or failure. This shared feedback applies to built-in and configured syncs.

Configured execution is intentionally stricter than the built-in per-row processing: it validates every eligible row, field type, lookup, and normalized source/destination key before any staging write. A preflight failure writes no staging records. Each record write uses a transaction with locking; records with unchanged mapped fields are skipped. Per-record database failures produce explicit failed counts and audit records while other records may succeed. No records are deleted. Configured runs for one staging table are serialized within one API process; this is not a distributed lock.

Run audit details include the saved mapping version. Configuration saves and immutable history use the existing `IntegrationMappings` and `IntegrationMappingVersions` tables with provider `sap-staging`, isolated from `sharepoint`. No additional migration or regenerated Prisma client is required if the mapping/history migrations are already installed. Versions are appended atomically with the current configuration; stale saves return HTTP 409.

Version history shows a read-only **Saved SAP SQL query** alongside that version's readable field mappings. Viewing old SQL does not execute it or change the editor. Legacy snapshots without SQL remain viewable without live schema discovery.

Query endpoints: `POST /api/mappings/sap-staging/test-query` accepts `{ module, query }`; `POST /columns` accepts the same body and returns source metadata plus fixed destination metadata. Existing GET `/columns?module=...` remains for legacy built-in configurations. SQL is sent in request bodies, not URL query strings.

## Permissions and limits

Editable queries use a dedicated small SAP pool with a 15-second request timeout and read-only connection intent, using existing SAP environment credentials. Read-only intent is a routing hint, not a permission boundary: deploy with a SELECT-only SAP account and no elevated roles/write permissions. Application SELECT validation does not replace least-privilege database permissions. The account also needs access to result metadata for its permitted queries. The staging account needs schema metadata access, SELECT/INSERT/UPDATE on the four destinations, SELECT on lookup/reference tables, and existing mapping/history/audit permissions. Credentials remain in the API environment.

Staging scalar string, UUID, boolean, and numeric fields are supported. Identity, computed, timestamps, and other unsupported types are unavailable in dropdowns. Queries are limited to 50,000 characters and 200 uniquely named output columns. Test samples stream up to five rows and cancel further reading. Execution streams at most 50,001 rows and rejects results over 50,000 before any staging write, rather than silently truncating. Preview without additional source filters similarly stops at five; filtered preview reads the bounded full result before choosing eligible samples. Selected runs filter query results by the selected source key; Item Class also retains the `Initials` alias shortcut. Full destination keys are still loaded into memory. Large datasets need narrower queries or future batching.

Validation: API `npm run build` and `node --test tests/mappings.test.cjs tests/mappings-engine.test.cjs tests/mappings-store.test.cjs tests/sap-mapping-sources.test.cjs tests/sap-mappings-engine.test.cjs tests/sap-mappings-routes.test.cjs tests/sap-query.test.cjs`; UI `npm run lint` and `npm run build`. `node tests/sap-mappings.browser.cjs` verifies query testing, alias dropdowns, SQL/field version snapshots and read-only history with mocked API responses; it never runs a SAP/staging sync. Existing SharePoint modal/list/layout browser checks cover shared-editor regression behavior.

The mocked `node tests/new-mappings.browser.cjs` check verifies two independent mappings per provider, duplicate-ID rejection, reload/persistence, separate versions/history and exact manual-run routing without live database access.
