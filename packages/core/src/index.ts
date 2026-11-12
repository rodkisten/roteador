export type Handler<Env = unknown> = (context: {
  req: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response> | object | string | number | boolean | null | undefined;

type Route<Env> = { method: string; path: string; handler: Handler<Env>; pattern: RegExp; keys: string[] };

function compile(path: string) {
  const keys: string[] = [];
  const pattern = path.split("/").map((part) => {
    if (part.startsWith(":")) {
      keys.push(part.slice(1));
      return "([^/]+)";
    }
    if (part === "*") return "(.*)";
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { keys, pattern: new RegExp("^" + pattern + "/?$") };
}

function response(value: unknown): Response {
  if (value instanceof Response) return value;
  if (value === undefined || value === null) return new Response(null, { status: 204 });
  if (typeof value === "string") return new Response(value);
  return Response.json(value);
}

export function createApp<Env = unknown>() {
  const routes: Route<Env>[] = [];
  const register = (method: string, path: string, handler: Handler<Env>) => {
    routes.push({ method, path, handler, ...compile(path) });
    return app;
  };
  const app = {
    get: (path: string, handler: Handler<Env>) => register("GET", path, handler),
    post: (path: string, handler: Handler<Env>) => register("POST", path, handler),
    put: (path: string, handler: Handler<Env>) => register("PUT", path, handler),
    delete: (path: string, handler: Handler<Env>) => register("DELETE", path, handler),
    route: (definition: { method: string; path: string; handler: Handler<Env> }) =>
      register(definition.method.toUpperCase(), definition.path, definition.handler),
    fetch: async (req: Request, env: Env): Promise<Response> => {
      const path = new URL(req.url).pathname;
      let allowed = false;
      for (const route of routes) {
        const match = route.pattern.exec(path);
        if (!match) continue;
        if (route.method !== req.method && !(req.method === "HEAD" && route.method === "GET")) {
          allowed = true;
          continue;
        }
        const params: Record<string, string> = {};
        for (let i = 0; i < route.keys.length; i++) {
          const value = match[i + 1];
          if (value !== undefined) {
            try { params[route.keys[i]!] = decodeURIComponent(value); }
            catch { return Response.json({ error: "Invalid path encoding" }, { status: 400 }); }
          }
        }
        try {
          const result = await route.handler({ req, env, params });
          const res = response(result);
          return req.method === "HEAD" ? new Response(null, res) : res;
        } catch {
          return Response.json({ error: "Internal Server Error" }, { status: 500 });
        }
      }
      return Response.json({ error: allowed ? "Method Not Allowed" : "Not Found" }, { status: allowed ? 405 : 404 });
    },
  };
  return app;
}

export function route<Env>(definition: { method: string; path: string; handler: Handler<Env> }) {
  return definition;
}
