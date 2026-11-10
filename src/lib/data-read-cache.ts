import { NextFunction, Request, Response } from "express";

type Entry = { expires: number; promise: Promise<unknown> };
const entries = new Map<string, Entry>();
const ttl = 15000;
export function invalidateDataReads() { entries.clear(); }
export function cachedDataRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [id, entry] of entries) if (entry.expires <= now) entries.delete(id);
  const current = entries.get(key);
  if (current) return current.promise as Promise<T>;
  while (entries.size >= 8) entries.delete(entries.keys().next().value!);
  const entry: Entry = { expires: now + 30000, promise: Promise.resolve() };
  entry.promise = Promise.resolve().then(read).then(value => {
    // An invalidated in-flight read must never repopulate the cache after a sync.
    if (entries.get(key) === entry) {
      if (Array.isArray(value) && value.length > 50000) entries.delete(key);
      else entry.expires = Date.now() + ttl;
    }
    return value;
  }, error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
  entries.set(key, entry);
  return entry.promise as Promise<T>;
}
export function dataReadCacheLifecycle(req: Request, res: Response, next: NextFunction) {
  const read = req.method === "GET" && (req.path.startsWith("/sync/data/") || req.path.startsWith("/api/audit/"));
  const sync = req.method === "POST" && ((req.path.startsWith("/sync/") && /\/run(?:\/|$)/.test(req.path)) ||
    (req.path.startsWith("/api/mappings/") && req.path.endsWith("/run")));
  if (read && req.get("X-Refresh-Data") === "1") invalidateDataReads();
  if (sync) { invalidateDataReads(); res.once("finish", invalidateDataReads); }
  next();
}
