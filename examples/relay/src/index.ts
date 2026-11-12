import { type } from "arktype";
import { createApp } from "@rodkisten/roteador";

interface Env {
  MEDIA_QUEUE: Queue<{ url: string; caption?: string }>;
}

const app = createApp<Env>();

app.get("/health", () => ({ ok: true }));

app.route({
  method: "POST",
  path: "/media",
  body: type({ url: "string.url", "caption?": "string" }),
  handler: async ({ body, env }) => {
    await env.MEDIA_QUEUE.send(body);
    return Response.json({ queued: true }, { status: 202 });
  },
});

export default { fetch: app.fetch };
