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
