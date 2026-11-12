import { describe, expect, it } from "vitest";
import { bearerAuth, cors } from "./middleware";
import { createApp } from "./index";

describe("HTTP middleware", () => {
  it("handles allowed CORS preflight before route dispatch", async () => {
    const app = createApp();
    app.use(cors({ origin: ["https://relay.test"], credentials: true, maxAge: 600 }));
    app.get("/media", () => ({ ok: true }));
    const response = await app.fetch(new Request("https://api.test/media", {
      method: "OPTIONS",
      headers: { Origin: "https://relay.test", "Access-Control-Request-Method": "GET" },
    }), undefined);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://relay.test");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not grant CORS to disallowed origins", async () => {
    const app = createApp();
    app.use(cors({ origin: "https://relay.test" }));
    app.get("/", () => "ok");
    const response = await app.fetch(new Request("https://api.test/", {
      headers: { Origin: "https://untrusted.test" },
    }), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("rejects invalid bearer tokens and accepts verified ones", async () => {
    const app = createApp<{ secret: string }>();
    app.use(bearerAuth((token, env) => token === env.secret));
    app.get("/private", () => "ok");
    const url = "https://api.test/private";
    expect((await app.fetch(new Request(url), { secret: "safe" })).status).toBe(401);
    expect((await app.fetch(new Request(url, {
      headers: { Authorization: "Bearer wrong" },
    }), { secret: "safe" })).status).toBe(401);
    expect((await app.fetch(new Request(url, {
      headers: { Authorization: "Bearer safe" },
    }), { secret: "safe" })).status).toBe(200);
  });
});
