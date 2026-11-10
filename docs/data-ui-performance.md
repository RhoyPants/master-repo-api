# Master Data and sync workspace performance

Warehouses, Item Class, Item Group, Items and UOM share the same Master Data and sync workspace components. Payment Terms remains an explicit not-connected placeholder; its former link to an unavailable sync route is removed.

## Browsing and comparing

- Master Data has source tabs, record totals, search, collapsible detailed filters, status filtering, explicit Refresh, sticky table headings and pagination.
- Syncing has independent source/destination tables, counts, loading indicators, errors/retry and pagination. A slow destination does not hide a ready source. Changing one side does not fetch the unchanged side again.
- Text filters settle after 350 ms. Source/filter/page-size changes reset pagination; canceled older requests cannot put another source's rows under the active heading.
- Fresh results are cached for 30 seconds and retained for 10 minutes. Master Data and sync use identical query keys, sharing matching source/filter/page/limit results. Returning to a recently visited tab avoids a network request while fresh.
- Pagination may retain the previous page while the new one loads, only for the same module/source/filters. Those placeholder rows cannot be selected. Other sources' rows are never placeholders.
- Sync selection uses stable record codes, not row indexes, and can span pages (up to 2,000 keys). Changing direction/filters clears selection. Select current page means exactly that page.
- Full sync remains separate from selection. Preview filters do not restrict the backend full-run query; the action bar states this. Unsupported directions remain available for comparison, with execution disabled. Directions that only support full sync do not offer row selection.
- Existing full/single/multiple request URLs and payload keys are preserved. Confirmation and the blocking Sync in progress modal remain active through the operation and follow-up refresh. Duplicate submissions are guarded synchronously. Partial/failed results retain their actual API counts and error details.

## Backend improvements

SharePoint table readers share an in-flight/expiry-aware access token, rather than requesting one for every table/page. Successful collection reads are cached for 15 seconds in a bounded, process-local cache (eight entries, snapshots above 50,000 rows are not cached). Concurrent identical reads share work. Errors are not cached. In-flight reads invalidated by a sync cannot repopulate the cache afterward.

Collection keys cover each data module; the Item reader also keys server-side filter combinations. Search and pagination are still applied according to each existing service's behavior. Existing SharePoint collection limits and full-list scans are not silently changed. Individual Graph page/auth requests have 20-second timeouts. SAP and Item Master pool acquisition share a pending connection to avoid parallel initial connection attempts.

Manual Refresh sends `X-Refresh-Data: 1` to bypass server data caching. Sync endpoints invalidate read caches before execution and after response completion, including partial/failing runs and configured mapping runs. The UI invalidates cached master/audit/dashboard views after submitted runs and explicitly reloads both visible sync tables.

These caches are not a distributed cache. External edits or other API processes can remain invisible until the cache expires or the user refreshes. A cold SharePoint read can still be slow because the existing integration traverses all pages before local pagination/search. No live latency benchmark is claimed: tests verify request counts, concurrency, expiry and behavior using controlled fixtures.

## Files and checks

Shared UI: `app/lib/masterData.ts`, `app/lib/syncData.ts`, `app/components/data/DataWorkspace.tsx`, `app/components/data/SyncWorkspace.tsx`. Backend: `src/lib/data-read-cache.ts`, `src/lib/sharepoint-token.ts`, the existing data readers and connection helpers.

```powershell
# API
npm run build
node --test tests/data-read-cache.test.cjs tests/data-sharepoint-cache.test.cjs
node tests/data-workspace.browser.cjs
node tests/sync-progress.browser.cjs
# UI
npm run lint
npm run build
```

Browser checks intercept all data/sync API requests and do not contact live services or write data. They check cached tabs, debounce, source isolation, manual refresh, independent panels, stable cross-page selection, post-sync sharing, progress/error handling and responsive layout. Screenshots are written to the temporary directory. The backend tests check cache lifetime, invalidation, deduplication and shared tokens.
