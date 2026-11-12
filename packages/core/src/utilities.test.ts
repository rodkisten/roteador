import { describe, expect, it, vi } from "vitest";
import { basicAuth, bodyLimit, createApp, getCookie, logger, prettyJSON, secureHeaders, setCookie } from "./index";

const req = (path = "/", init?: RequestInit) => new Request("https://example.test" + path, init);

describe("HTTP utilities", () => {
  it("supports multiple middleware in one use call, preserving onion order", async () => {
    const app = createApp();
    const calls: string[] = [];
    const outer = async (_ctx: unknown, next: () => Promise<Response>) => {
      calls.push("outer-before");
      const response = await next();
      calls.push("outer-after");
      return response;
    };
    const inner = async (_ctx: unknown, next: () => Promise<Response>) => {
      calls.push("inner-before");
      const response = await next();
      calls.push("inner-after");
      return response;
    };
    app.use(outer, inner);
    app.get("/", () => { calls.push("handler"); return "ok"; });
    expect((await app.fetch(req(), undefined)).status).toBe(200);
    expect(calls).toEqual(["outer-before", "inner-before", "handler", "inner-after", "outer-after"]);
  });

  it("supports spread middleware presets and multiple group middleware", async () => {
    const app = createApp();
    const preset = [secureHeaders(), prettyJSON()] as const;
    app.use(...preset);
    app.group("/admin", (group) => {
      group.use(
        async ({ state }, next) => { state.first = true; return next(); },
        async ({ state }, next) => { state.second = true; return next(); },
      );
      group.get("/", ({ state }) => ({ ...state }));
    });
    const response = await app.fetch(req("/admin"), undefined);
    expect(await response.json()).toEqual({ first: true, second: true });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("accepts valid Basic credentials and rejects malformed or incorrect credentials", async () => {
    const app = createApp();
    app.use(basicAuth({ realm: "Private", verify: async (user, pass) => user === "rod" && pass === "secret" }));
    app.get("/", () => "ok");
    for (const header of ["", "Basic !!!", "Basic " + btoa("rod:wrong")]) {
      const response = await app.fetch(req("/", { headers: { authorization: header } }), undefined);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Basic realm="Private"');
    }
    expect((await app.fetch(req("/", { headers: { authorization: "Basic " + btoa("rod:secret") } }), undefined)).status).toBe(200);
  });

  it("limits actual request bytes and checks Content-Length", async () => {
    const app = createApp();
    app.use(bodyLimit(5));
    app.post("/", () => "ok");
    expect((await app.fetch(req("/", { method: "POST", body: "12345" }), undefined)).status).toBe(200);
    expect((await app.fetch(req("/", { method: "POST", body: "123456" }), undefined)).status).toBe(413);
    expect(() => bodyLimit(-1)).toThrow();
  });

  it("adds secure response headers without changing payloads", async () => {
    const app = createApp();
    app.use(secureHeaders());
    app.get("/", () => ({ ok: true }));
    const response = await app.fetch(req(), undefined);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("logs method, path, status and duration", async () => {
    const spy = vi.fn();
    const app = createApp();
    app.use(logger(spy));
    app.get("/health", () => "ok");
    await app.fetch(req("/health"), undefined);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET", path: "/health", status: 200, durationMs: expect.any(Number),
    }));
  });

  it("pretty prints JSON and leaves plain text untouched", async () => {
    const app = createApp();
    app.use(prettyJSON(2));
    app.get("/json", () => ({ a: 1 }));
    app.get("/text", () => "ok");
    expect(await (await app.fetch(req("/json"), undefined)).text()).toBe('{\n  "a": 1\n}');
    expect(await (await app.fetch(req("/text"), undefined)).text()).toBe("ok");
  });

  it("reads and writes cookies safely", () => {
    expect(getCookie(req("/", { headers: { cookie: "session=hello%20world; theme=dark" } }), "session")).toBe("hello world");
    expect(getCookie(req(), "missing")).toBeUndefined();
    const headers = new Headers();
    setCookie(headers, "session", "hello world", { httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(headers.get("set-cookie")).toContain("session=hello%20world");
    expect(headers.get("set-cookie")).toContain("HttpOnly");
    expect(() => setCookie(headers, "bad name", "x")).toThrow();
    expect(() => setCookie(headers, "session", "x", { sameSite: "None" })).toThrow();
  });
});
