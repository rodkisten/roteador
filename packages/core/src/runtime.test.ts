import { describe, expect, it } from "vitest";
import { createApp, HttpError } from "./index";

const request = (path: string, init?: RequestInit) => new Request("https://relay.test" + path, init);
const schema = {
  "~standard": {
    version: 1 as const,
    vendor: "test",
    validate: (value: unknown) => typeof value === "object" && value !== null && "url" in value
      ? { value } : { issues: [{ message: "url required" }] },
  },
};

describe("Roteador v0", () => {
  it("validates JSON body through Standard Schema", async () => {
    const app = createApp();
    app.route({ method: "POST", path: "/media", body: schema, handler: ({ body }) => body });
    const ok = await app.fetch(request("/media", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "x" }),
    }), undefined);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ url: "x" });
    const invalid = await app.fetch(request("/media", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }), undefined);
    expect(invalid.status).toBe(400);
  });
  it("rejects unsupported content types", async () => {
    const app = createApp();
    app.route({ method: "POST", path: "/media", body: schema, handler: () => "ok" });
    expect((await app.fetch(request("/media", { method: "POST", body: "text" }), undefined)).status).toBe(415);
  });
  it("supports middleware ordering and short circuit", async () => {
    const app = createApp();
    const calls: string[] = [];
    app.use(async (_, next) => {
      calls.push("before");
      const result = await next();
      calls.push("after");
      return result;
    });
    app.get("/", () => { calls.push("handler"); return "ok"; });
    expect((await app.fetch(request("/"), undefined)).status).toBe(200);
    expect(calls).toEqual(["before", "handler", "after"]);
    const blocked = createApp();
    blocked.use(async () => new Response("blocked", { status: 401 }));
    blocked.get("/", () => { throw new Error("must not execute"); });
    expect((await blocked.fetch(request("/"), undefined)).status).toBe(401);
  });
  it("returns sanitized errors and HTTP status codes", async () => {
    const app = createApp();
    app.get("/private", () => { throw new Error("secret"); });
    app.get("/missing", () => { throw new HttpError(403, "Forbidden", "DENIED"); });
    expect(await (await app.fetch(request("/private"), undefined)).json()).toEqual({
      error: "Internal Server Error",
    });
    expect((await app.fetch(request("/missing"), undefined)).status).toBe(403);
    expect((await app.fetch(request("/missing", { method: "POST" }), undefined)).status).toBe(405);
  });
  it("handles HEAD, invalid encoding and duplicate routes", async () => {
    const app = createApp();
    app.get("/media/:id", ({ params }) => params);
    const head = await app.fetch(request("/media/123", { method: "HEAD" }), undefined);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await app.fetch(request("/media/%ZZ"), undefined)).status).toBe(400);
    expect(() => app.get("/media/:id", () => "again")).toThrow("Duplicate route");
  });
  it("isolates request state and supports waitUntil", async () => {
    const app = createApp<{ name: string }>();
    const jobs: Promise<unknown>[] = [];
    app.get("/", ({ env, state, waitUntil }) => {
      state.count = Number(state.count ?? 0) + 1;
      waitUntil(Promise.resolve());
      return { name: env.name, count: state.count };
    });
    for (let i = 0; i < 2; i++) {
      const result = await app.fetch(request("/"), { name: "relay" }, { waitUntil: p => { jobs.push(p); } });
      expect(await result.json()).toEqual({ name: "relay", count: 1 });
    }
    expect(jobs).toHaveLength(2);
  });
});
