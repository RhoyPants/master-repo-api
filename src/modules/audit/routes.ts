import { NextFunction, Request, Response, Router } from "express";
import { prisma } from "../../lib/prisma";
import { AuditInputError, auditOverview, describeTransaction, integer, listRuns, runDetails, runItems } from "./service";

const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res)).catch(next); };
export const auditRouter = Router();
auditRouter.get("/overview", route(async (req, res) => {
  const days = integer(req.query.days, 7, 30);
  if (![7, 30].includes(days)) throw new AuditInputError("Choose 7 or 30 days.");
  res.json(await auditOverview(days));
}));
auditRouter.get("/types", route(async (_req, res) => res.json((await prisma.transactionType.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } })).map(type => ({ ...type, ...describeTransaction(type.code) })))));
auditRouter.get("/runs", route(async (req, res) => res.json(await listRuns(req.query))));
auditRouter.get("/runs/:id", route(async (req, res) => res.json(await runDetails(integer(req.params.id, 0, 2147483647)))));
auditRouter.get("/runs/:id/items", route(async (req, res) => res.json(await runItems(integer(req.params.id, 0, 2147483647), req.query))));
auditRouter.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AuditInputError) { res.status(error.status).json({ message: error.message }); return; }
  console.error("Audit data query failed:", error instanceof Error ? error.name : "Unknown error");
  res.status(500).json({ message: "Could not load audit data. Check the API database connection and audit tables." });
});
