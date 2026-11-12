import { describe, expect, it } from "vitest";
import { createApp } from "./index";

const request = (path: string) => new Request("https://api.test" + path);

describe("route groups", () => {
  it("mounts nested routes and preserves dynamic parameters", async () => {
    const app = createApp();
    app.group("/api", (api) => {
      api.group("/v1", (v1) => {
        v1.get("/users/:id", ({ params }) => ({ id: params.id }));
      });
    });
    const response = await app.fetch(request("/api/v1/users/42"), undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "42" });
    expect((await app.fetch(request("/users/42"), undefined)).status).toBe(404);
  });

  it("isolates middleware and retains registration order", async () => {
    const calls: string[] = [];
    const app = createApp();
    app.use(async (_, next) => { calls.push("global"); return next(); });
    app.group("/private", (privateGroup) => {
      privateGroup.use(async (_, next) => { calls.push("private"); return next(); });
      privateGroup.get("/item", () => { calls.push("handler"); return "ok"; });
    });
    app.get("/public", () => "public");
    await app.fetch(request("/private/item"), undefined);
    expect(calls).toEqual(["global", "private", "handler"]);
    calls.length = 0;
    await app.fetch(request("/public"), undefined);
    expect(calls).toEqual(["global"]);
  });

  it("rejects duplicate full paths across groups", () => {
    const app = createApp();
    app.group("/api", (group) => group.get("/health", () => "ok"));
    expect(() => app.get("/api/health", () => "duplicate")).toThrow("Duplicate route");
  });

  it("supports schema-validated handlers inside groups", async () => {
    const app = createApp();
    const body = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate(value: unknown) {
          return typeof value === "object" && value !== null && "name" in value
            ? { value: value as { name: string } }
            : { issues: [{ message: "name required" }] };
        },
      },
    };
    app.group("/api", (api) => {
      api.route({ method: "POST", path: "/users", body, handler: ({ body: input }) => input });
    });
    const response = await app.fetch(new Request("https://api.test/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Rod" }),
    }), undefined);
    expect(await response.json()).toEqual({ name: "Rod" });
  });
});
