# Item Master to staging mappings

Open **Mappings > Item Master > Staging Mapping** (`/itemmaster-mapping`). Create independent named mappings and freely choose an available **source table in Item Master**, **destination table in staging**, and **matching keys**. Table lists and columns come from the connected databases. The original item-group mapping continues to drive the existing sync entry points.

## Add independent mappings

Click **New mapping**, enter a unique **New mapping ID** and **New mapping name**, and select the item-group template. **Create draft** starts an unsaved, disabled copy of that template. Choose the desired source/destination tables and keys, edit fields/filters, preview, then save. Creating a draft does not save or sync anything. IDs use lowercase letters, numbers and hyphens, up to 50 characters; duplicate IDs are rejected.

The **Mapping** selector includes the original template and all saved custom IDs. Each mapping has its own configuration, enabled flag, version sequence, manual run and readable history. Reloading the page retains saved mappings. Editing/saving one does not overwrite another. Unsaved changes are discarded only after confirmation when switching away.

Enable and save a custom mapping to use **Run saved mapping** for that specific configuration. Multiple custom mappings can be enabled simultaneously. Existing `/sync/itemmaster-staging/...` buttons, including the aggregate endpoint, always use the original `item-group` mapping ID; they do not choose a custom mapping or run all enabled mappings. If that original mapping is absent/disabled, the buttons retain built-in behavior.

In JSON/storage, `module` is the unique mapping ID. New custom mappings include `syncModule: "item-group"` as their template module; earlier Item Master snapshots without this field remain supported. Save, history and manual-run URLs accept each custom ID (`/:mappingId`, `/:mappingId/history`, `/:mappingId/history/:version`, `/:mappingId/run`). Column metadata requests still use `module=item-group`. Results include `mappingId` and audit details identify the saved mapping/version. Independent mappings targeting the same destination share the in-process execution lock. No additional migration is needed.

## Choosing tables and keys

1. Expand **Source & destination** and use **Refresh available tables** to reload both table lists.
2. Select **Item Master source table**. Schema-qualified choices, such as `dbo.item_classes`, read that physical table directly and expose its actual columns. They have no implicit joins, uppercase conversion or eligibility conditions: configure transformations and filters as needed.
3. Select **Staging destination table**. The schema, columns, required fields and managed columns are discovered from that selected table, including tables in other schemas.
4. Select **Source record key** and **Staging matching key**. Match using a writable, supported text, UUID or numeric destination column, not an identity/computed/timestamp/boolean column. Map the destination key from the chosen source key for both creates and updates. Generated UUIDs and constants cannot be matching-key rules.
5. Map other fields, **Validate & preview**, and **Save mapping**. Changing a table reloads columns and clears its key. Changing the source also clears filters. Existing field rules stay visible for explicit remapping; they are not silently rewritten.

Discovery follows the existing SharePoint mapping business-table exclusions: credential/user, audit, transaction-type, integration-configuration and underscore-prefixed tables are unavailable. Source and destination names must match discovered tables. Identifiers are quoted from metadata; SQL-shaped, nonexistent or unavailable table/column names are rejected. There is no custom SQL editor.

## Compatibility preset and initial template

**Built-in Item Groups (with Item Class details)** is a separate source preset with ID `item_groups`. Existing saved configurations retain this reader and its aliases. It differs from choosing the physical table `dbo.item_groups`:

- Reads item_groups with LEFT JOIN item_classes on item_class_code = code.
- Requires non-null group initials.
- Uppercases initials, group name, class initials/name and category using the existing SQL.
- Converts missing class initials/name to empty text before mapping.

The initial template uses this preset and dbo.ItemGroups. Both selections can be changed.

| Preset source field | Origin | Default staging field | Rule |
|---|---|---|---|
| ItemGroupID | item_groups.code | ItemGroupID | Copy |
| Initials | UPPER(item_groups.initials) | Initials | Copy |
| Name | UPPER(item_groups.name) | Name | Copy |
| ItemClassCode | UPPER(item_classes.initials), empty when null | ItemClassCode | Copy |
| ItemClass | UPPER(item_classes.name), empty when null | ItemClass | Copy |
| Category | UPPER(item_groups.category) | Category | Copy |
| No source needed | Fixed boolean true | IsActive | Constant |

The preset class code retains class initials, matching the original service. Physical sources expose actual columns/values. Old snapshots and history keep their saved selections without migration or automatic activation.

## Rules, preview, activation and history

The shared editor supports copy, uppercase/lowercase, trim, number/boolean conversion, constants, UUID values, value rules and staging-table lookups. Each rule can apply on create, update or both. Required destination fields without defaults need create mappings. Identity, computed and timestamp fields cannot be mapped. CreatedAt uses its database default; UpdatedAt is managed on changed existing records when present. Other defaults, constraints and references are enforced by the destination database.

Source equality filters must all match. Text comparisons trim and ignore case; null filters match actual null after any preset normalization. Preview displays up to five eligible rows with create/update payloads or row errors. It does not save, write destination rows or create sync audits.

Saving persists configuration only. Enable **Use saved mapping for sync** before saving to activate that snapshot. Save with the switch off to return existing entry points to built-in handlers. Unsaved edits do not affect sync. **Run saved mapping** executes all eligible rows after confirmation; it is disabled for dirty, disabled or never-saved configurations.

**More actions** contains JSON import/export and readable version history. Imports remain unsaved/disabled until saved. History preserves exact source/destination selections, keys, rules and filters. Viewing it does not restore a version or execute a sync, and works without live schema discovery.

## Existing sync integration

Enabled configurations drive:

- `POST /sync/itemmaster-staging/item-group/run`
- `POST /sync/itemmaster-staging/item-group/run/single` with `{ "code": "..." }` or legacy `{ "itemGroupId": "..." }`
- `POST /sync/itemmaster-staging/item-group/run/multiple` with `{ "codes": ["..."] }`
- `POST /sync/itemmaster-staging/run` (aggregate)

Selected codes refer to the **configured source key**. Only selected eligible rows are written; absent/filtered codes appear in missingCodes/missingDetails. The configured destination table and key drive writes; configured execution is not hardcoded to dbo.ItemGroups. Disabled/absent mappings retain the original built-in Item Group behavior. Missing mapping-storage tables also allow legacy fallback; other errors do not silently fall back.

The existing itemmaster-staging/item-group response envelope and itemGroupId compatibility field remain, even for other selected tables. mappingVersion identifies the configuration used. Aggregate sync retains HTTP 202 and its nested result. Audits use IM2SDB_ITEMGROUP or IM2SDB_ITEMGROUP_SELECTED and record source, destination and version.

Execution preflights every eligible row, required field, type, length, lookup and normalized key before writing. Duplicate/empty keys or invalid later rows block all writes. Unchanged rows are skipped without changing UpdatedAt. Values are parameterized and each record uses a transaction with update/range locks; per-record failures may yield partial success. No records are deleted. Configured runs for the same destination table are serialized within one API process, not across processes or legacy handlers.

## API, deployment and limits

Authenticated API prefix: `/api/mappings/itemmaster-staging`.

| Method/path | Purpose |
|---|---|
| GET / | Saved configurations, defaults and module information |
| GET /tables | Separate Item Master source and staging destination table lists |
| GET /columns?module=item-group&sourceTable=...&destinationTable=... | Columns for the selected pair; omitted table parameters use legacy defaults |
| POST /validate-json | Validate shape and matching-key rules |
| POST /preview | Validate live schema and preview mapped rows |
| PUT /item-group | Save config, enabled flag and expected version |
| GET /item-group/history | Versions, newest first |
| GET /item-group/history/:version | Full read-only snapshot |
| POST /item-group/run | Run saved enabled mapping with `{ "confirm": true }` |

Existing Item Master credentials need metadata/SELECT access to chosen source tables. Staging needs metadata and SELECT/INSERT/UPDATE access to destinations, SELECT on lookup tables, and mapping/history/audit permissions. Credentials stay in the API environment; authentication is inherited from app.ts.

Storage uses IntegrationMappings and IntegrationMappingVersions under provider **itemmaster-staging**, isolated from SAP and SharePoint. Saves append current configuration/history atomically; stale versions return HTTP 409. No new migration or Prisma generation is required when existing integration_mappings and mapping_version_history migrations are installed.

Physical reads select only required source columns and reject results over 50,000 rows before any write. This limit applies before in-memory filters and selected-code filtering. Preview/selected runs read the bounded source before sampling/filtering. The compatibility preset retains its existing full-reader behavior. Destination keys and lookup tables also load into memory. There is no batching or distributed lock. Supported destination types are scalar strings, UUID, boolean and numeric fields. Arbitrary joins and custom SQL are outside this table-based workflow.

## Verification

From master-repo-api:

```powershell
npm run build
node --test tests/itemmaster-mapping-sources.test.cjs tests/itemmaster-tables.test.cjs tests/itemmaster-mappings-engine.test.cjs tests/itemmaster-mappings-routes.test.cjs tests/mappings-store.test.cjs tests/sap-mappings-engine.test.cjs tests/sap-mapping-sources.test.cjs
```

From master-repo-ui, run `npm run lint` and `npm run build`. With the UI running locally, run `node tests/itemmaster-mappings.browser.cjs` from the API directory to verify changing both tables and keys, field mapping, preview, saving, history and run routing through mocked APIs. It never accesses live source/destination databases. Set MAPPING_UI_URL, MAPPING_PLAYWRIGHT_PATH or MAPPING_BROWSER_PATH for non-default tooling.

The mocked `node tests/new-mappings.browser.cjs` check verifies two independent mappings per provider, duplicate-ID rejection, reload/persistence, separate versions/history and exact manual-run routing without live database access.
