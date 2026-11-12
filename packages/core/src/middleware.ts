import { HttpError, type Middleware } from "./index";

/** Configure cross-origin response headers without exposing credentials to arbitrary origins. */
export type CorsOptions = {
  origin?: string | readonly string[] | ((origin: string) => boolean);
  methods?: readonly string[];
  headers?: readonly string[];
  exposeHeaders?: readonly string[];
  credentials?: boolean;
  maxAge?: number;
};

export function cors<Env>(options: CorsOptions = {}): Middleware<Env> {
  const allowed = options.origin ?? "*";
  return async ({ req }, next) => {
    const origin = req.headers.get("origin");
    if (!origin) return next();
    const permitted = typeof allowed === "function"
      ? allowed(origin)
      : Array.isArray(allowed) ? allowed.includes(origin) : allowed === "*" || allowed === origin;
    const allowOrigin = permitted ? (allowed === "*" && !options.credentials ? "*" : origin) : null;
    const preflight = req.method === "OPTIONS" && req.headers.has("access-control-request-method");
    const response = preflight ? new Response(null, { status: 204 }) : await next();
    const headers = new Headers(response.headers);
    headers.append("Vary", "Origin");
    if (allowOrigin) {
      headers.set("Access-Control-Allow-Origin", allowOrigin);
      if (options.credentials) headers.set("Access-Control-Allow-Credentials", "true");
      if (options.exposeHeaders?.length) headers.set("Access-Control-Expose-Headers", options.exposeHeaders.join(", "));
      if (preflight) {
        headers.append("Vary", "Access-Control-Request-Headers");
        headers.append("Vary", "Access-Control-Request-Method");
        headers.set("Access-Control-Allow-Methods", (options.methods ?? ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).join(", "));
        if (options.headers?.length) headers.set("Access-Control-Allow-Headers", options.headers.join(", "));
        else {
          const requested = req.headers.get("access-control-request-headers");
          if (requested) headers.set("Access-Control-Allow-Headers", requested);
        }
        if (options.maxAge !== undefined) headers.set("Access-Control-Max-Age", String(options.maxAge));
      }
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

/** Require a Bearer token, with async verification supplied by the application. */
export function bearerAuth<Env>(
  verify: (token: string, env: Env) => boolean | Promise<boolean>,
): Middleware<Env> {
  return async (context, next) => {
    const authorization = context.req.headers.get("authorization") ?? "";
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match || !(await verify(match[1]!, context.env))) {
      throw new HttpError(401, "Unauthorized", "UNAUTHORIZED");
    }
    return next();
  };
}
