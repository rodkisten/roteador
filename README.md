# Roteador

A small, Fetch-native HTTP framework for the Relay and Cloudflare Workers ecosystem.

**Status:** v0 development. Not yet published.

## Features

- Fluent `get/post/put/patch/delete` and declarative `route` registration
- Standard Schema validation (ArkType, Zod and other compatible validators)
- Composable middleware and per-request state
- Cloudflare `fetch(request, env, executionContext)` compatibility
- Native `Request`, `Response`, streaming and `waitUntil`
- Structured HTTP errors without exposing server internals

## Usage

```ts
import { createApp } from "@rodkisten/roteador";
import { type } from "arktype";

const app = createApp<{ MEDIA_QUEUE: Queue<unknown> }>();

app.get("/health", () => ({ ok: true }));
app.route({
  method: "POST",
  path: "/media",
  body: type({ url: "string.url" }),
  handler: async ({ body, env }) => {
    await env.MEDIA_QUEUE.send(body);
    return Response.json({ queued: true }, { status: 202 });
  },
});

export default { fetch: app.fetch };
```

See `examples/relay` for a Cloudflare Worker example.

## Development

```sh
pnpm install
pnpm build
pnpm -r typecheck
pnpm -r test
```

Route definitions are registered once at module initialization. The HTTP runtime
is independent of Cloudflare, while the Worker example demonstrates typed bindings.

## v0 limitations

No route groups, OpenAPI, RPC client, automatic OPTIONS/CORS or release pipeline yet.
JSON body validation requires an explicit schema. Keep the API behind existing
Relay authentication and rate limits until the corresponding middleware is implemented.
