import { describe, expect, it } from "vitest";
import { createApp } from "./index";

describe("roteador", () => {
  it("returns JSON from a handler", async () => {
    const app = createApp();
    app.get("/health", () => ({ ok: true }));
    const res = await app.fetch(new Request("https://example.com/health"), undefined);
    expect(await res.json()).toEqual({ ok: true });
  });
  it("extracts route params", async () => {
    const app = createApp();
    app.get("/media/:id", ({ params }) => params);
    const res = await app.fetch(new Request("https://example.com/media/abc"), undefined);
    expect(await res.json()).toEqual({ id: "abc" });
  });
  it("returns 404", async () => {
    const app = createApp();
    expect((await app.fetch(new Request("https://example.com/nope"), undefined)).status).toBe(404);
  });
});
