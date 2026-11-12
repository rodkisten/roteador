import { describe, expect, it } from "vitest";
import { createApp, HttpError, respond, route } from "./index";
import { bearerAuth, cors } from "./middleware";

const req = (path: string, init?: RequestInit) => new Request("https://example.test" + path, init);
const check = (predicate: (value: unknown) => boolean) => ({
  "~standard": {
    version: 1 as const,
    vendor: "test",
    validate: async (value: unknown) => predicate(value)
      ? { value }
      : { issues: [{ message: "invalid" }] },
  },
});

describe("public routing API", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)("dispatches %s", async (method) => {
    const app = createApp();
    const handlers = {
      GET: app.get, POST: app.post, PUT: app.put, PATCH: app.patch, DELETE: app.delete,
    };
    handlers[method]("/resource", () => ({ method }));
    const response = await app.fetch(req("/resource", { method }), undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ method });
  });

  it("supports declarative route helper", async () => {
    const app = createApp();
    app.route(route({ method: "GET", path: "/declarative", handler: () => "yes" }));
    expect(await (await app.fetch(req("/declarative"), undefined)).text()).toBe("yes");
  });

  it("returns 404 for unknown paths and 405 for wrong methods", async () => {
    const app = createApp();
    app.get("/known", () => "ok");
    expect((await app.fetch(req("/unknown"), undefined)).status).toBe(404);
    expect((await app.fetch(req("/known", { method: "POST" }), undefined)).status).toBe(405);
  });

  it("decodes parameters, matches wildcard and optional trailing slash", async () => {
    const app = createApp();
    app.get("/users/:name", ({ params }) => params.name);
    app.get("/assets/*", ({ params }) => params["*"]);
    expect(await (await app.fetch(req("/users/Jo%C3%A3o/"), undefined)).text()).toBe("João");
    expect(await (await app.fetch(req("/assets/a/b/c"), undefined)).text()).toBe("a/b/c");
    expect((await app.fetch(req("/users/%ZZ"), undefined)).status).toBe(400);
  });

  it("rejects malformed paths and duplicate route definitions", () => {
    const app = createApp();
    expect(() => app.get("relative", () => "x")).toThrow();
    expect(() => app.get("/: ", () => "x")).not.toThrow();
    expect(() => app.get("/:", () => "x")).toThrow();
    app.get("/same", () => "ok");
    expect(() => app.get("/same", () => "again")).toThrow();
  });

  it("handles strings, JSON, empty bodies, native responses and HEAD", async () => {
    const app = createApp();
    app.get("/string", () => "hello");
    app.get("/json", () => ({ ok: true }));
    app.get("/empty", () => undefined);
    app.get("/native", () => new Response("created", { status: 201 }));
    expect(await (await app.fetch(req("/string"), undefined)).text()).toBe("hello");
    expect(await (await app.fetch(req("/json"), undefined)).json()).toEqual({ ok: true });
    expect((await app.fetch(req("/empty"), undefined)).status).toBe(204);
    expect((await app.fetch(req("/native"), undefined)).status).toBe(201);
    const head = await app.fetch(req("/string", { method: "HEAD" }), undefined);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("validates params, query and JSON body with async Standard Schemas", async () => {
    const app = createApp();
    app.route({
      method: "POST", path: "/users/:id",
      params: check((v) => typeof v === "object" && v !== null && "id" in v),
      query: check((v) => typeof v === "object" && v !== null && "page" in v),
      body: check((v) => typeof v === "object" && v !== null && "name" in v),
      handler: ({ params, query, body }) => ({ params, query, body }),
    });
    const post = (path: string, body: string, contentType = "application/json") =>
      app.fetch(req(path, { method: "POST", headers: { "content-type": contentType }, body }), undefined);
    expect((await post("/users/1?page=2", '{"name":"Rod"}')).status).toBe(200);
    expect((await post("/users/1", '{"name":"Rod"}')).status).toBe(400);
    expect((await post("/users/1?page=2", "{}")).status).toBe(400);
    expect((await post("/users/1?page=2", "{broken")).status).toBe(400);
    expect((await post("/users/1?page=2", "{}", "text/plain")).status).toBe(415);
  });

  it("runs middleware in order, supports short-circuiting and isolates state", async () => {
    const app = createApp();
    const calls: string[] = [];
    app.use(async (ctx, next) => {
      calls.push("outer-before");
      ctx.state.count = Number(ctx.state.count ?? 0) + 1;
      const response = await next();
      calls.push("outer-after");
      return response;
    });
    app.use(async (_ctx, next) => { calls.push("inner"); return next(); });
    app.get("/state", ({ state }) => ({ count: state.count }));
    for (let i = 0; i < 2; i++) {
      expect(await (await app.fetch(req("/state"), undefined)).json()).toEqual({ count: 1 });
    }
    expect(calls).toEqual([
      "outer-before", "inner", "outer-after", "outer-before", "inner", "outer-after",
    ]);
    const blocked = createApp();
    blocked.use(async () => new Response("blocked", { status: 403 }));
    blocked.get("/", () => { throw new Error("must not run"); });
    expect((await blocked.fetch(req("/"), undefined)).status).toBe(403);
  });

  it("supports nested groups and prevents middleware leakage", async () => {
    const app = createApp();
    app.group("/api", (api) => {
      api.use(async ({ state }, next) => { state.group = true; return next(); });
      api.group("/v1", (v1) => v1.get("/status", ({ state }) => state));
    });
    app.get("/outside", ({ state }) => state);
    expect(await (await app.fetch(req("/api/v1/status"), undefined)).json()).toEqual({ group: true });
    expect(await (await app.fetch(req("/outside"), undefined)).json()).toEqual({});
  });

  it("uses waitUntil when available and rejects missing execution context", async () => {
    const app = createApp();
    const promises: Promise<unknown>[] = [];
    app.get("/", ({ waitUntil }) => { waitUntil(Promise.resolve()); return "ok"; });
    expect((await app.fetch(req("/"), undefined, { waitUntil: (p) => promises.push(p) })).status).toBe(200);
    expect(promises).toHaveLength(1);
    expect((await app.fetch(req("/"), undefined)).status).toBe(500);
  });
});

describe("security middleware", () => {
  it("supports CORS preflight, explicit origin and credentials", async () => {
    const app = createApp();
    app.use(cors({ origin: "https://client.test", credentials: true, methods: ["POST"], headers: ["authorization"], maxAge: 120 }));
    app.post("/items", () => "ok");
    const response = await app.fetch(req("/items", {
      method: "OPTIONS",
      headers: { origin: "https://client.test", "access-control-request-method": "POST" },
    }), undefined);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://client.test");
    expect(response.headers.get("access-control-allow-methods")).toBe("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe("authorization");
    expect(response.headers.get("access-control-max-age")).toBe("120");
  });

  it("does not grant CORS to rejected origins", async () => {
    const app = createApp();
    app.use(cors({ origin: (origin) => origin.endsWith(".trusted.test") }));
    app.get("/", () => "ok");
    const response = await app.fetch(req("/", { headers: { origin: "https://evil.test" } }), undefined);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("supports asynchronous bearer verification and rejects malformed headers", async () => {
    const app = createApp<{ token: string }>();
    app.use(bearerAuth(async (token, env) => token === env.token));
    app.get("/", () => "ok");
    for (const header of ["Basic valid", "Bearer invalid", "Bearer", "Bearer valid extra"]) {
      expect((await app.fetch(req("/", { headers: { authorization: header } }), { token: "valid" })).status).toBe(401);
    }
    expect((await app.fetch(req("/", { headers: { authorization: "Bearer valid" } }), { token: "valid" })).status).toBe(200);
  });
});

describe("response contracts and error hooks", () => {
  it("accepts valid declared statuses and rejects undeclared statuses", async () => {
    const app = createApp();
    app.route({
      method: "GET", path: "/created",
      responses: { 201: check((v) => typeof v === "object" && v !== null && "id" in v) },
      handler: () => respond(201, { id: "1" }),
    });
    app.route({
      method: "GET", path: "/wrong",
      responses: { 201: check(() => true) },
      handler: () => new Response('{"id":"1"}', { status: 202 }),
    });
    expect((await app.fetch(req("/created"), undefined)).status).toBe(201);
    expect((await app.fetch(req("/wrong"), undefined)).status).toBe(500);
  });

  it("rejects invalid JSON output and preserves response confidentiality", async () => {
    const app = createApp();
    app.route({
      method: "GET", path: "/bad",
      responses: { 200: check(() => false) },
      handler: () => Response.json({ secret: "do-not-leak" }),
    });
    const response = await app.fetch(req("/bad"), undefined);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("do-not-leak");
  });

  it("allows hooks to override errors or decline handling", async () => {
    const app = createApp();
    app.onError((error) => error instanceof HttpError
      ? Response.json({ code: error.code }, { status: error.status })
      : undefined);
    app.get("/known", () => { throw new HttpError(422, "Unprocessable", "INVALID"); });
    app.get("/unknown", () => { throw new Error("private detail"); });
    expect(await (await app.fetch(req("/known"), undefined)).json()).toEqual({ code: "INVALID" });
    expect(await (await app.fetch(req("/unknown"), undefined)).json()).toEqual({ error: "Internal Server Error" });
  });

  it("sanitizes errors thrown by the error hook", async () => {
    const app = createApp();
    app.onError(() => { throw new Error("hook secret"); });
    app.get("/", () => { throw new Error("handler secret"); });
    const response = await app.fetch(req("/"), undefined);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });
});
