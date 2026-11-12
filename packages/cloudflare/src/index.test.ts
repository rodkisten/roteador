import { describe, expect, it } from "vitest";
import { createWorker } from "./index";

describe("Cloudflare adapter", () => {
  it("creates a fetch-compatible worker", async () => {
    const app = createWorker<{ SERVICE_NAME: string }>();
    app.get("/health", ({ env }) => ({ service: env.SERVICE_NAME }));
    const response = await app.fetch(
      new Request("https://relay.example.com/health"),
      { SERVICE_NAME: "relay" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "relay" });
  });

  it("preserves native Response objects", async () => {
    const app = createWorker();
    app.get("/text", () => new Response("ready", { status: 202 }));
    const response = await app.fetch(new Request("https://relay.example.com/text"), undefined);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("ready");
  });
});
