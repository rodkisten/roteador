<div align="center">

# 🧭 Roteador

**A tiny, type-friendly HTTP router built on the Web Platform.**

*Native Fetch API · TypeScript · Standard Schema · Cloudflare Workers*

[![CI](https://github.com/rodkisten/roteador/actions/workflows/ci.yml/badge.svg)](https://github.com/rodkisten/roteador/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40rodkisten%2Froteador?logo=npm)](https://www.npmjs.com/package/@rodkisten/roteador)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**[Getting started](#-getting-started) · [Examples](#-recipes--use-cases) · [API](#-api-reference) · [Roadmap](#-roadmap) · [Contributing](#-contributing)**

</div>

> [!IMPORTANT]
> **v0 development.** The code is evolving; check [npm](https://www.npmjs.com/package/@rodkisten/roteador)
> for published versions before installing. Examples below describe the current repository API,
> not a stability guarantee.

## Contents

- [Why Roteador?](#-why-roteador)
- [Features](#-features)
- [Getting started](#-getting-started)
- [Recipes & use cases](#-recipes--use-cases)
  - [Health checks](#health-checks)
  - [REST endpoints and path parameters](#rest-endpoints-and-path-parameters)
  - [Query strings](#query-strings)
  - [JSON request validation](#json-request-validation)
  - [Reusable middleware](#reusable-middleware)
  - [Nested route groups](#nested-route-groups)
  - [CORS](#cors)
  - [Bearer authentication](#bearer-authentication)
  - [Cloudflare Workers and queues](#cloudflare-workers-and-queues)
  - [Background work with waitUntil](#background-work-with-waituntil)
  - [Custom responses and streaming](#custom-responses-and-streaming)
  - [Errors and status codes](#errors-and-status-codes)
  - [Testing routes](#testing-routes)
- [API reference](#-api-reference)
- [Behavior and limitations](#-behavior-and-limitations)
- [Project structure](#-project-structure)
- [Development](#-development)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [Security](#-security)
- [License](#-license)

## ✨ Why Roteador?

Roteador is a small HTTP foundation for applications that already speak the browser's
**Request** and **Response** language. No custom request object, no Node.js-only
server dependency, and no requirement to choose a particular schema library.

- **Fetch-native:** write handlers using Web Platform primitives.
- **Schema-friendly:** validate route input using Standard Schema-compatible libraries.
- **Middleware-first:** compose cross-cutting behavior around handlers.
- **Edge-friendly:** pass Cloudflare bindings through a typed `env`.
- **Simple by design:** a route returns a `Response`, a string, JSON-serializable data, or nothing.

## 🧩 Features

| Capability | Status |
| --- | --- |
| GET, POST, PUT, PATCH, DELETE | ✅ Implemented |
| Declarative route definitions | ✅ Implemented |
| Path parameters and wildcard routes | ✅ Implemented |
| Query and JSON body parsing | ✅ Implemented |
| Standard Schema validation | ✅ Implemented |
| Global and route-registration middleware | ✅ Implemented |
| Request-local state and `waitUntil` | ✅ Implemented |
| Native `Response`, streaming and HEAD | ✅ Implemented |
| Structured HTTP errors | ✅ Implemented |
| Nested route groups and scoped middleware | ✅ Implemented in repository |
| CORS and Bearer middleware | ✅ Implemented in repository |
| OpenAPI generation | 🗺️ Planned |
| Typed response contracts | 🗺️ Planned |
| RPC client generation | 🗺️ Planned |
| Built-in rate limiting | 🗺️ Planned |

## 🚀 Getting started

**Requirements:** a runtime with the standard Fetch API and TypeScript if you want static types.

```bash
pnpm add @rodkisten/roteador
# or
npm install @rodkisten/roteador
```

> Installation succeeds only once a version has been published to npm.

```ts
import { createApp } from "@rodkisten/roteador";

const app = createApp();

app.get("/", () => ({ message: "Hello from Roteador!" }));
app.get("/health", () => ({ ok: true }));

export default app;
```

Call `app.fetch(request, env, executionContext?)` to dispatch a request. In a Cloudflare
Worker, `export default app` exposes the `fetch` method directly.

## 📚 Recipes & use cases

### Health checks

```ts
app.get("/health", () => ({ status: "healthy" }));
app.get("/ready", () => new Response(null, { status: 204 }));
```

A returned object becomes JSON. Returning `null` or `undefined` also produces HTTP 204.

### REST endpoints and path parameters

```ts
app.get("/users/:id", ({ params }) => ({ userId: params.id }));
app.post("/users", () => Response.json({ created: true }, { status: 201 }));
app.put("/users/:id", ({ params }) => ({ updated: params.id }));
app.patch("/users/:id", ({ params }) => ({ patched: params.id }));
app.delete("/users/:id", () => new Response(null, { status: 204 }));
```

A single `*` segment captures the remaining path in `params["*"]`.

### Query strings

```ts
app.get("/search", ({ query }) => ({
  term: query.q ?? "",
  page: Number(query.page ?? "1"),
}));
```

Without a query schema, values are strings. Repeated keys are collapsed to the last value.

### JSON request validation

Use a [Standard Schema](https://standardschema.dev/)-compatible validator, such as ArkType.

```ts
import { type } from "arktype";

app.route({
  method: "POST",
  path: "/media",
  body: type({
    url: "string.url",
    "caption?": "string",
  }),
  handler: ({ body }) => ({ accepted: body.url }),
});
```

You can validate URL parameters and query strings in the same way:

```ts
app.route({
  method: "GET",
  path: "/items/:id",
  params: type({ id: "string" }),
  query: type({ "sort?": "'asc' | 'desc'" }),
  handler: ({ params, query }) => ({
    id: params.id,
    sort: query.sort ?? "asc",
  }),
});
```

**Current behavior:** invalid schema input returns HTTP 400. A declared JSON body schema
requires a JSON content type; otherwise the response is HTTP 415. The body is only parsed
when a route declares a body schema.

### Reusable middleware

```ts
app.use(async (ctx, next) => {
  const started = performance.now();
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("Server-Timing", `app;dur=${(performance.now() - started).toFixed(1)}`);
  return new Response(response.body, { status: response.status, headers });
});
```

Middleware receives `(context, next)` and may return early to block a request.

```ts
app.use(async ({ req }, next) => {
  if (req.headers.get("x-maintenance") === "true") {
    return Response.json({ error: "Maintenance" }, { status: 503 });
  }
  return next();
});
```

Middleware is snapshotted **when each route is registered**. Register shared middleware
before the routes that should receive it.

### Nested route groups

Organize larger APIs without repeating prefixes.

```ts
app.group("/api", (api) => {
  api.get("/health", () => ({ ok: true }));

  api.group("/v1", (v1) => {
    v1.use(async (ctx, next) => {
      ctx.state.apiVersion = "v1";
      return next();
    });

    v1.get("/users/:id", ({ params }) => ({ id: params.id }));
  });
});
```

Group middleware applies to subsequently registered routes in that group and its
descendants, not unrelated routes.

### CORS

```ts
import { cors } from "@rodkisten/roteador";

app.use(cors({
  origin: ["https://app.example.com"],
  credentials: true,
  methods: ["GET", "POST"],
  headers: ["content-type", "authorization"],
  maxAge: 600,
}));
```

Register CORS **before** your routes. It handles matching preflight `OPTIONS` requests
and adds appropriate response headers. CORS is a browser access policy, **not authentication**.

### Bearer authentication

```ts
import { bearerAuth, createApp } from "@rodkisten/roteador";

type Env = { API_TOKEN: string };
const privateApp = createApp<Env>();

privateApp.use(bearerAuth((token, env) => token === env.API_TOKEN));
privateApp.get("/private", () => ({ secret: "protected resource" }));
```

The verifier can be asynchronous. Invalid or missing credentials return HTTP 401.
For production, use a suitable token-verification mechanism; this simple equality
check is only an illustrative example.

### Cloudflare Workers and queues

```ts
import { type } from "arktype";
import { createApp } from "@rodkisten/roteador";

interface Env {
  MEDIA_QUEUE: Queue<{ url: string; caption?: string }>;
}

const worker = createApp<Env>();

worker.route({
  method: "POST",
  path: "/media",
  body: type({ url: "string.url", "caption?": "string" }),
  handler: async ({ body, env }) => {
    await env.MEDIA_QUEUE.send(body);
    return Response.json({ queued: true }, { status: 202 });
  },
});

export default worker;
```

The `Queue` type is provided by Cloudflare Workers typings. See
[`examples/relay`](examples/relay) for the repository's integration example.

### Background work with waitUntil

```ts
app.post("/events", ({ waitUntil }) => {
  waitUntil(Promise.resolve().then(() => {
    // Send telemetry or perform non-critical follow-up work.
  }));
  return Response.json({ accepted: true }, { status: 202 });
});
```

`waitUntil` requires an execution context supporting `waitUntil`; calling it without one
returns an HTTP 500 error.

### Custom responses and streaming

```ts
app.get("/text", () => "plain text");
app.get("/redirect", () => Response.redirect("https://example.com", 302));

app.get("/stream", () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
});
```

Return a native `Response` for full control of status, headers, cookies and streaming.

### Errors and status codes

```ts
import { HttpError } from "@rodkisten/roteador";

app.get("/admin", () => {
  throw new HttpError(403, "Forbidden", "ACCESS_DENIED");
});
```

Known HTTP errors serialize to `{ "error": "Forbidden", "code": "ACCESS_DENIED" }`.
Unexpected exceptions become HTTP 500 without exposing stack traces. Unknown paths
return 404; a path matched with the wrong method returns 405. HEAD requests reuse
GET routes with an empty response body.

### Testing routes

No HTTP server is required: construct a `Request` and call `app.fetch`.

```ts
import { expect, it } from "vitest";
import { createApp } from "@rodkisten/roteador";

it("responds to health checks", async () => {
  const app = createApp();
  app.get("/health", () => ({ ok: true }));

  const response = await app.fetch(new Request("https://test.local/health"), undefined);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
```

## 📖 API reference

| API | Purpose |
| --- | --- |
| `createApp<Env>()` | Create a Fetch-native router with typed environment bindings |
| `app.get/post/put/patch/delete(path, handler)` | Register a method-specific route |
| `app.route({ method, path, handler, params?, query?, body? })` | Register a declarative route with optional Standard Schemas |
| `app.use(middleware)` | Register middleware for subsequent routes |
| `app.group(prefix, callback)` | Register prefixed and nested route groups |
| `app.fetch(request, env, execution?)` | Dispatch a request and return a Promise<Response> |
| `cors(options?)` | Apply CORS headers and handle preflight |
| `bearerAuth(verify)` | Require an application-verified Bearer token |
| `new HttpError(status, message, code?)` | Return a controlled HTTP error |

Handler context:

| Property | Meaning |
| --- | --- |
| `req` | Native `Request` |
| `env` | Environment bindings of type `Env` |
| `params` | Decoded path parameters or schema output |
| `query` | Query values or schema output |
| `body` | Validated JSON body when a body schema is provided |
| `state` | Request-local mutable record |
| `waitUntil(promise)` | Schedule background work via the execution context |

## ⚠️ Behavior and limitations

- **v0 API:** signatures may change before a stable release.
- **JSON only:** built-in body parsing currently requires a declared schema and JSON content type.
- **No automatic output validation:** return values are serialized but not schema-checked.
- **No built-in rate limiter:** configure limits at the edge or add your own middleware.
- **No OpenAPI/RPC generation yet:** these are roadmap items, not shipping APIs.
- **Middleware scope:** registrations affect only routes added after them.
- **CORS scope:** preflight is matched against registered routes; it is not a general-purpose catch-all OPTIONS handler.
- **Security:** protect sensitive routes with authentication and authorization appropriate to your deployment.

## 🗂️ Project structure

```text
roteador/
├── packages/
│   ├── core/            # HTTP router, validation and middleware
│   └── cloudflare/      # Cloudflare-oriented entry point
├── examples/
│   └── relay/           # Queue-backed Cloudflare Worker example
├── .github/workflows/   # CI, npm release and code maintenance
└── README.md
```

## 🛠️ Development

```bash
git clone https://github.com/rodkisten/roteador.git
cd roteador
pnpm install
pnpm build
pnpm -r typecheck
pnpm -r test
pnpm lint
pnpm format:check
```

To apply formatting and safe lint fixes locally:

```bash
pnpm format
pnpm lint:fix
```

The repository also contains a manually dispatched / scheduled auto-fix workflow that
proposes changes through pull requests instead of pushing formatting changes directly
to `main`.

## 🗺️ Roadmap

- [x] Fetch-native route registration and dispatch
- [x] Standard Schema validation
- [x] Middleware, typed bindings and `waitUntil`
- [x] Nested route groups
- [x] CORS and Bearer authentication helpers
- [ ] Response schemas and typed status contracts
- [ ] Configurable error hooks
- [ ] OpenAPI document generation
- [ ] Type-safe RPC client
- [ ] More adapters and integration examples
- [ ] Stable v1 API

**Documentation policy:** every PR introducing or changing a public API must update
the relevant README recipe, API reference and roadmap entry in the same PR.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## 🤝 Contributing

Bug reports, feature ideas, documentation improvements and PRs are welcome.
Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## 🔐 Security

Please do not post credentials or exploitable vulnerabilities in public issues.
See [SECURITY.md](SECURITY.md) for reporting guidance. Authentication examples
are minimal illustrations, not a complete authorization system.

## 📄 License

MIT. See [LICENSE](LICENSE).
