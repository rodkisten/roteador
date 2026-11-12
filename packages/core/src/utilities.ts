import { HttpError, type Middleware } from "./index";

export type BasicAuthOptions<Env> = {
  verify: (username: string, password: string, env: Env) => boolean | Promise<boolean>;
  realm?: string;
};

export function basicAuth<Env>(options: BasicAuthOptions<Env>): Middleware<Env> {
  return async (context, next) => {
    const header = context.req.headers.get("authorization") ?? "";
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
    let valid = false;
    if (match) {
      try {
        const decoded = atob(match[1]!);
        const separator = decoded.indexOf(":");
        if (separator >= 0) {
          valid = await options.verify(decoded.slice(0, separator), decoded.slice(separator + 1), context.env);
        }
      } catch { /* Invalid Base64. */ }
    }
    if (!valid) {
      const realm = (options.realm ?? "Restricted").replace(/["\\\r\n]/g, "");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": `Basic realm="${realm}"` },
      });
    }
    return next();
  };
}

export function bodyLimit<Env>(maxBytes: number): Middleware<Env> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError("Invalid body limit");
  return async ({ req }, next) => {
    const length = req.headers.get("content-length");
    if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) {
      throw new HttpError(413, "Payload Too Large", "BODY_TOO_LARGE");
    }
    if (req.body) {
      const reader = req.clone().body!.getReader();
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new HttpError(413, "Payload Too Large", "BODY_TOO_LARGE");
        }
      } finally {
        // A cloned Request tees its stream. Waiting for cancellation can deadlock
        // while the original branch remains unread; release without awaiting it.
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }
    return next();
  };
}

export function secureHeaders<Env>(): Middleware<Env> {
  return async (_context, next) => {
    const response = await next();
    const headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
    headers.set("x-frame-options", "DENY");
    headers.set("cross-origin-resource-policy", "same-origin");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

export function logger<Env>(
  log: (entry: { method: string; path: string; status: number; durationMs: number }) => void = console.info,
): Middleware<Env> {
  return async ({ req }, next) => {
    const start = performance.now();
    try {
      const response = await next();
      log({ method: req.method, path: new URL(req.url).pathname, status: response.status, durationMs: performance.now() - start });
      return response;
    } catch (error) {
      log({ method: req.method, path: new URL(req.url).pathname, status: error instanceof HttpError ? error.status : 500, durationMs: performance.now() - start });
      throw error;
    }
  };
}

export function prettyJSON<Env>(spaces = 2): Middleware<Env> {
  if (!Number.isInteger(spaces) || spaces < 0 || spaces > 10) throw new TypeError("Invalid indentation");
  return async (_context, next) => {
    const response = await next();
    if (!response.headers.get("content-type")?.includes("application/json") || response.status === 204) return response;
    let data: unknown;
    try { data = await response.clone().json(); }
    catch { return response; }
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(JSON.stringify(data, null, spaces), { status: response.status, statusText: response.statusText, headers });
  };
}

export function getCookie(req: Request, name: string): string | undefined {
  const pair = (req.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(name + "="));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(name.length + 1)); }
  catch { return undefined; }
}

export type CookieOptions = {
  path?: string; domain?: string; maxAge?: number; secure?: boolean;
  httpOnly?: boolean; sameSite?: "Strict" | "Lax" | "None";
};

export function setCookie(headers: Headers, name: string, value: string, options: CookieOptions = {}): void {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new TypeError("Invalid cookie name");
  if (options.sameSite === "None" && !options.secure) throw new TypeError("SameSite=None requires Secure");
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  if (options.secure) parts.push("Secure");
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  headers.append("Set-Cookie", parts.join("; "));
}
