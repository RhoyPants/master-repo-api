import { env } from "../config/env";

type Token = { expires: number; promise: Promise<string> };
let current: Token | undefined;
export function getSharePointReadToken(): Promise<string> {
  if (current && current.expires > Date.now()) return current.promise;
  const { tenantId, clientId, clientSecret } = env.sharePoint;
  if (!tenantId || !clientId || !clientSecret) return Promise.reject(new Error("Missing SharePoint credentials in the API environment."));
  const entry: Token = { expires: Infinity, promise: Promise.resolve("") };
  entry.promise = (async () => {
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    });
    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!response.ok || !data.access_token) throw new Error(`SharePoint authentication failed (${response.status}). Check API credentials and permissions.`);
    entry.expires = Date.now() + Math.max(0, Number(data.expires_in ?? 300) - 60) * 1000;
    return data.access_token;
  })().catch(error => { if (current === entry) current = undefined; throw error; });
  current = entry;
  return entry.promise;
}
