import { NextFunction, Request, Response } from "express";
import { MappingError } from "./domain";

export const mappingRoute = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res)).catch(next); };
export function mappingId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,49}$/.test(value)) throw new MappingError("Use a mapping ID with lowercase letters, numbers and hyphens (up to 50 characters).");
  return value;
}
export function queryText(req: Request, name: string) {
  const value = req.query[name];
  if (typeof value !== "string" || !value.trim() || value.length > 1000) throw new MappingError(`${name} is required.`);
  return value;
}
export function positiveVersion(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) throw new MappingError("A positive integer version is required.");
  return Number(value);
}
export function selectedMappingCodes(body: Record<string, unknown>, mode?: string) {
  if (mode === "single") {
    const value = body.code ?? body.whCode ?? body.itmsGrpCod ?? body.itemGroupId ?? body.itemCode ?? body.uomCode;
    if (typeof value !== "string" || !value.trim()) throw new MappingError("A non-empty record code is required.");
    return [value];
  }
  if (mode === "multiple") {
    const values = body.codes ?? body.whCodes ?? body.itemCodes ?? body.uomCodes;
    if (!Array.isArray(values) || !values.length || values.length > 2000 || values.some(value => typeof value !== "string" || !value.trim())) throw new MappingError("Provide between 1 and 2000 non-empty record codes.");
    return values as string[];
  }
  return undefined;
}
