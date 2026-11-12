/**
 * Roteador v0: Fetch-native HTTP runtime.
 *
 * The registry is immutable during request handling: register routes at module
 * initialization, then reuse the same app for every Cloudflare invocation.
 */
export type MaybePromise<T> = T | Promise<T>;
export type StandardSchema<Input = unknown, Output = Input> = {
  "~standard": {
    version: 1;
    vendor: string;
    validate(value: unknown): MaybePromise<
      | { value: Output; issues?: undefined }
      | { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<unknown> }> }
    >;
    types?: { input: Input; output: Output };
  };
};
type Infer<S> = S extends StandardSchema<any, infer O> ? O : unknown;
type Schemas = { params?: StandardSchema<any, any>; query?: StandardSchema<any, any>; body?: StandardSchema<any, any> };
export type Context<Env, S extends Schemas = {}> = {
  req: Request;
  env: Env;
  params: NonNullable<S["params"]> extends StandardSchema<any, any> ? Infer<NonNullable<S["params"]>> : Record<string, string>;
  query: NonNullable<S["query"]> extends StandardSchema<any, any> ? Infer<NonNullable<S["query"]>> : Record<string, string>;
  body: NonNullable<S["body"]> extends StandardSchema<any, any> ? Infer<NonNullable<S["body"]>> : unknown;
  state: Record<string, unknown>;
  waitUntil(promise: Promise<unknown>): void;
};
export type Handler<Env, S extends Schemas = {}> =
  (context: Context<Env, S>) => MaybePromise<unknown>;
export type Middleware<Env> = (
  context: Context<Env>,
  next: () => Promise<Response>,
) => MaybePromise<Response>;
export type RouteDefinition<Env, S extends Schemas = {}> = S & {
  method: string;
  path: string;
  handler: Handler<Env, S>;
};
type Registered<Env> = {
  method: string;
  path: string;
  matcher: RegExp;
  keys: string[];
  schemas: Schemas;
  handler: Handler<Env, any>;
  middleware: Middleware<Env>[];
};

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = "HTTP_ERROR") {
    super(message);
    this.name = "HttpError";
  }
}

function compile(path: string) {
  if (!path.startsWith("/")) throw new TypeError("Routes must start with /");
  const keys: string[] = [];
  const pattern = path.split("/").map((part) => {
    if (part === "*") { keys.push("*"); return "(.*)"; }
    if (part.startsWith(":")) {
      if (part.length === 1) throw new TypeError("Empty route parameter");
      keys.push(part.slice(1));
      return "([^/]+)";
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { keys, matcher: new RegExp("^" + pattern + "/?$") };
}

function serialize(value: unknown): Response {
  if (value instanceof Response) return value;
  if (value === undefined || value === null) return new Response(null, { status: 204 });
  if (typeof value === "string") return new Response(value);
  return Response.json(value);
}

async function validate(schema: StandardSchema | undefined, input: unknown, location: string) {
  if (!schema) return input;
  const result = await schema["~standard"].validate(input);
  if ("issues" in result && result.issues) {
    throw new HttpError(400, "Invalid " + location, "VALIDATION_ERROR");
  }
  return (result as { value: unknown }).value;
}

function queryObject(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams);
}

async function parseBody(req: Request) {
  const contentType = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new HttpError(415, "Expected JSON request body", "UNSUPPORTED_MEDIA_TYPE");
  }
  try { return await req.json(); }
  catch { throw new HttpError(400, "Invalid JSON body", "INVALID_JSON"); }
}

export function createApp<Env = unknown>() {
  const routes: Registered<Env>[] = [];
  const globalMiddleware: Middleware<Env>[] = [];

  const app = {
    use(middleware: Middleware<Env>) {
      globalMiddleware.push(middleware);
      return app;
    },
    route<const S extends Schemas>(definition: S & { method: string; path: string; handler: Handler<Env, NoInfer<S>> }) {
      const { matcher, keys } = compile(definition.path);
      if (routes.some((r) => r.method === definition.method.toUpperCase() && r.path === definition.path)) {
        throw new TypeError("Duplicate route: " + definition.method + " " + definition.path);
      }
      routes.push({
        method: definition.method.toUpperCase(),
        path: definition.path,
        matcher,
        keys,
        schemas: definition,
        handler: definition.handler,
        middleware: [...globalMiddleware],
      });
      return app;
    },
    get(path: string, handler: Handler<Env>) { return app.route({ method: "GET", path, handler }); },
    post(path: string, handler: Handler<Env>) { return app.route({ method: "POST", path, handler }); },
    put(path: string, handler: Handler<Env>) { return app.route({ method: "PUT", path, handler }); },
    patch(path: string, handler: Handler<Env>) { return app.route({ method: "PATCH", path, handler }); },
    delete(path: string, handler: Handler<Env>) { return app.route({ method: "DELETE", path, handler }); },
    async fetch(req: Request, env: Env, execution?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
      try {
        const url = new URL(req.url);
        let methodMismatch = false;
        for (const route of routes) {
          const match = route.matcher.exec(url.pathname);
          if (!match) continue;
          if (route.method !== req.method && !(req.method === "HEAD" && route.method === "GET")) {
            methodMismatch = true;
            continue;
          }
          const params: Record<string, string> = {};
          for (let i = 0; i < route.keys.length; i++) {
            try { params[route.keys[i]!] = decodeURIComponent(match[i + 1] ?? ""); }
            catch { throw new HttpError(400, "Invalid URL encoding", "INVALID_PATH"); }
          }
          // Validate only schemas declared by the route; body streams are never
          // consumed for routes that do not explicitly request validation.
          const context: Context<Env> = {
            req, env, params, query: queryObject(url), body: undefined,
            state: {},
            waitUntil(promise) {
              if (!execution) throw new HttpError(500, "Execution context unavailable");
              execution.waitUntil(promise);
            },
          };
          let next = async () => {
            context.params = await validate(route.schemas.params, params, "params") as Record<string, string>;
            context.query = await validate(route.schemas.query, context.query, "query") as Record<string, string>;
            if (route.schemas.body) context.body = await validate(route.schemas.body, await parseBody(req), "body");
            return serialize(await route.handler(context));
          };
          // Compose backwards so middleware executes in registration order.
          for (const middleware of [...route.middleware].reverse()) {
            const downstream = next;
            next = async () => serialize(await middleware(context, downstream));
          }
          const response = await next();
          return req.method === "HEAD" ? new Response(null, response) : response;
        }
        return Response.json({ error: methodMismatch ? "Method Not Allowed" : "Not Found" }, {
          status: methodMismatch ? 405 : 404,
        });
      } catch (error) {
        if (error instanceof HttpError) {
          return Response.json({ error: error.message, code: error.code }, { status: error.status });
        }
        // Do not leak stack traces or internal exception messages to clients.
        return Response.json({ error: "Internal Server Error" }, { status: 500 });
      }
    },
  };
  return app;
}

export function route<Env, S extends Schemas>(definition: RouteDefinition<Env, S>) {
  return definition;
}
