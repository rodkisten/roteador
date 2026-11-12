import { describe, expect, it } from "vitest";
import { createApp, HttpError, respond } from "./index";

const schema = (check: (value: unknown) => boolean) => ({
  "~standard": {
    version: 1 as const,
    vendor: "test",
    validate(value: unknown) {
      return check(value) ? { value } : { issues: [{ message: "Invalid output" }] };
    },
  },
});

const request = (path: string) => new Request("https://api.test" + path);

describe("response contracts", () => {
  it("serializes status-specific JSON responses", async () => {
    const app = createApp();
    app.route({
      method: "POST", path: "/items",
      responses: { 201: schema((value) => typeof value === "object" && value !== null && "id" in value) },
      handler: () => respond(201, { id: "item-1" }, { "x-created": "yes" }),
    });
    const response = await app.fetch(new Request("https://api.test/items", { method: "POST" }), undefined);
    expect(response.status).toBe(201);
    expect(response.headers.get("x-created")).toBe("yes");
    expect(await response.json()).toEqual({ id: "item-1" });
  });

  it("rejects invalid and undeclared output without exposing payloads", async () => {
    const app = createApp();
    app.route({
      method: "GET", path: "/invalid",
      responses: { 200: schema(() => false) },
      handler: () => ({ secret: "private" }),
    });
    app.route({
      method: "GET", path: "/undeclared",
      responses: { 201: schema(() => true) },
      handler: () => ({ secret: "private" }),
    });
    for (const path of ["/invalid", "/undeclared"]) {
      const response = await app.fetch(request(path), undefined);
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("private");
    }
  });
});

describe("configurable error hooks", () => {
  it("handles known errors with a custom response", async () => {
    const app = createApp();
    app.onError((error) => error instanceof HttpError
      ? Response.json({ reason: error.code }, { status: error.status })
      : undefined);
    app.get("/private", () => { throw new HttpError(403, "Forbidden", "DENIED"); });
    const response = await app.fetch(request("/private"), undefined);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: "DENIED" });
  });

  it("falls back to safe errors when hooks decline or throw", async () => {
    const app = createApp();
    app.onError(() => { throw new Error("hook secret"); });
    app.get("/error", () => { throw new Error("internal secret"); });
    const response = await app.fetch(request("/error"), undefined);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal Server Error" });
  });

  it("passes request and environment to hooks", async () => {
    const app = createApp<{ label: string }>();
    app.onError((_error, { req, env }) => Response.json({ path: new URL(req.url).pathname, label: env.label }));
    app.get("/fail", () => { throw new Error("failure"); });
    const response = await app.fetch(request("/fail"), { label: "test" });
    expect(await response.json()).toEqual({ path: "/fail", label: "test" });
  });
});
