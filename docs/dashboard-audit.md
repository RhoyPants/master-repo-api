# Dashboard and audit trail

The Dashboard (`/dashboard`) and Audit Logs (`/audit`) read authenticated, persisted sync history. They do not start syncs while loading. All displayed dates/times use **Asia/Manila (PHT)**, including calendar-day filters and charts.

## Dashboard

- Choose **Last 7 days** or **Last 30 days**, including today in Philippine time.
- Summary cards show recorded run count, completed-run success rate, records created/updated, and failed records. Success rate is SUCCESS / (SUCCESS + PARTIAL + FAILED); RUNNING is excluded. No completed runs produces a dash, not a fabricated 100%.
- Daily stacked activity bars distinguish successful, partial/failed, and in-progress runs. Selecting a bar opens that date's audit trail.
- Operations pulse checks the API and staging database through the existing health endpoint. It does not imply SAP, Item Master, AIMS or SharePoint connectivity was tested.
- Recorded in-progress count covers all dates. A crashed process can leave RUNNING rows; the UI states this rather than claiming those processes are currently executing.
- Recent runs show the latest eight runs across all dates, with initiator, flow, status, timestamp and changed-record count. Each links to its full audit details.
- Module activity summarizes runs, changed records and failures for the selected period. Quick links open data, syncing and mapping pages; they do not perform writes.

Overview and health checks refresh every 30 seconds. Failed reads display an error, retaining clearly labeled previously loaded data where available. The API overview uses database aggregates, not a download of all item-level logs. It shares the bounded 15-second read cache and is invalidated around sync requests. The dashboard Refresh action bypasses that server read cache.

## Audit Logs: one run, then its records

Each parent row represents one persisted audit run: module/flow, started time, initiator, status, total records, created/updated/skipped/failed counts and duration. Expand the row to see:

- Run UUID, start/end time, full/selected scope as recorded, and transaction code.
- A snapshot of the authenticated initiating user's ID, name and email.
- Paginated child entries with entity, record key, action and result, plus failures/reasons.
- Per-record expansion with before/after changes or recorded inserted values when that sync implementation supplies them.
- Recorded run messages, including configured mapping identity/version/source/destination information.

Search runs by record key, transaction type, recorded actor information or a complete run UUID. Filters cover date range, status and sync type. **Needs attention** includes PARTIAL and FAILED. **Today**, **Last 7 days**, **All dates** and Reset shortcuts update the filters. Record filters and pagination are independent of the parent list. Run details are fetched on expansion; no full item history is loaded with the list.

`/audit?run=123` deep-links to a run, even when it is outside the list's selected date range. Dashboard chart links pass `from` and `to` dates. A missing run returns 404; malformed dates, filters, page sizes and identifiers return 400. Date end boundaries are exclusive at the following Philippine midnight.

## Recording identity and details

The existing AuditLogs, AuditLogDetails and AuditTransactionItems tables are reused. There are **no new required columns** and no actor foreign key that can lose attribution if an account changes later.

- After authentication, AsyncLocalStorage isolates each request's actor. Audit creation writes an ACTOR detail with a bounded JSON identity snapshot, nested into the audit insert.
- Built-in SAP and Item Master services and configured SAP/Item Master/SharePoint engines include this snapshot.
- Built-in staging-to-SharePoint controllers now wrap their operations in a persisted RUNNING audit and close it as SUCCESS/PARTIAL/FAILED. Item details are written in batches of 100. Successful Item and selected Warehouse operations now include individual result entries rather than only failed records.
- Built-in SAP Item sync now persists successful creates, updates and skips as well as failures. Updated values and before/after changes are retained where available. Other services that already calculate changes retain those in item payloads.
- Selected Item Master and configured SharePoint runs use a SELECTED transaction code suffix for new records.
- Audit results preserve the sync operation's counters. If detail persistence fails after the operation returns, the run is marked FAILED with an explicit audit-recording error; counters already saved are retained. A missing audit store prevents the newly wrapped operation from starting.

Older history is **not backfilled**. Missing actor snapshots display **Not recorded**. Missing field changes display a clear absence message; records are not fabricated from summary counts. Older or interrupted runs with fewer item entries than their totals are marked incomplete. Older scope labels are limited to their stored transaction-code conventions.

Only actual supported audited operations appear. Queued placeholder integrations are not presented as successful completed syncs. Mapping validation/source preflight can reject a request before its engine creates an audit row. Per-item timestamps are not in the existing schema: the UI shows the enclosing run's start/end times, not invented individual timestamps. A process stopping before finalization may leave a RUNNING row or incomplete details.

## API

All endpoints inherit the API's existing authentication and internal access model:

| Endpoint | Purpose |
|---|---|
| GET /api/audit/overview?days=7 | Window totals, success rate, daily activity, module activity, latest runs |
| GET /api/audit/types | Recorded transaction types with readable module/flow labels |
| GET /api/audit/runs | Paginated runs; page, limit, from, to, search, status, type filters |
| GET /api/audit/runs/:id | Run, actor, counts and messages |
| GET /api/audit/runs/:id/items | Paginated records; page, limit, search, status, action filters |

Default page size is 20, maximum 100. Run IDs in API paths are AuditLogs integer IDs; the run UUID is included in every response. Actor snapshots, item errors and business-field payloads are authenticated data, not public endpoints.

Successful/failed UI sync submissions invalidate cached Master Data, audit lists/details/types and dashboard summaries. Opening these views after a sync fetches fresh data. Run progress remains visible until its source/destination refresh completes.

## Deployment and verification

Existing audit tables must be installed. No Prisma client regeneration or data backfill is required for the feature. The optional `20261109090000_audit_query_indexes` migration adds date/order and per-run status/action indexes for larger histories. It is included in source but is **not automatically applied to a live database**. The features work with the existing indexes; apply the new migration through normal database deployment.

From master-repo-api:

```powershell
npm run build
npx prisma validate
node --test tests/audit-context.test.cjs tests/audit-legacy-sync.test.cjs tests/audit-api.test.cjs tests/audit-sap-items.test.cjs tests/sap-mappings-engine.test.cjs tests/itemmaster-mappings-engine.test.cjs tests/mappings-engine.test.cjs
node tests/dashboard-audit.browser.cjs
```

From master-repo-ui, run `npm run lint` and `npm run build`. The browser test uses mocked API fixtures and never submits a sync. It covers summary metrics, period changes, date/run links, actor snapshots, readable changes, record filters, legacy unknowns, errors and desktop/mobile layout. Screenshot artifacts go to the temporary directory. Set MAPPING_UI_URL, MAPPING_PLAYWRIGHT_PATH or MAPPING_BROWSER_PATH for non-default local tooling.
