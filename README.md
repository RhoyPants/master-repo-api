# Express + Prisma + SQL Server Backend

Starter backend API using Express, Prisma, SQL Server, and TypeScript.

## Requirements

- Node.js 20+
- SQL Server database

## Setup

1. Copy environment template:
   - `cp .env.example .env` (or manually create `.env` on Windows)
2. Set a valid `DATABASE_URL` in `.env`.
3. Generate Prisma client:
   - `npm run prisma:generate`
4. Run migrations:
   - `npm run prisma:migrate`

## Run

- Development: `npm run dev`
- Build: `npm run build`
- Production: `npm start`

## Endpoints

- `GET /` - basic service info
- `GET /api/health` - API and DB health check

## Configurable mappings

- [Staging to SharePoint mappings](docs/sharepoint-mapping.md)
- [SAP to staging mappings](docs/sap-staging-mapping.md)
- [Item Master to staging mappings](docs/itemmaster-staging-mapping.md) — table-based Item Group mapping, preview, saved activation and history.

SAP and Item Master support **New mapping** with independent IDs, names, saved versions, enable flags and manual runs. Existing sync buttons continue to use original mapping IDs; custom mappings run through their own **Run saved mapping** action. See each guide for template choices and routing details.

## Operations UI and audit APIs

- [Dashboard and per-run audit trail](docs/dashboard-audit.md): live aggregates, recorded initiators, paginated record results/changes, API endpoints, historical limits and optional audit indexes.
- [Master Data and sync UI performance](docs/data-ui-performance.md): shared tables, independent sync panels, caching, debounced filters, stable selection and verification.
