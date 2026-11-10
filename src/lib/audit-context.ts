import { AsyncLocalStorage } from "node:async_hooks";
import { NextFunction, Request, Response } from "express";

type Actor = { userId: number; name: string; email: string; path: string };
const context = new AsyncLocalStorage<Actor>();
export function auditRequestContext(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) { next(); return; }
  context.run({ userId: req.user.id, name: req.user.name, email: req.user.email, path: req.path }, next);
}
export function auditActorData() {
  const actor = context.getStore();
  if (!actor) return {};
  const snapshot = { userId: actor.userId, name: actor.name.slice(0, 255), email: actor.email.slice(0, 255) };
  let message = JSON.stringify(snapshot);
  while (message.length > 1000) {
    snapshot.name = snapshot.name.slice(0, -40); snapshot.email = snapshot.email.slice(0, -40);
    message = JSON.stringify(snapshot);
  }
  return { details: { create: [{ level: "INFO", step: "ACTOR", message }] } };
}
