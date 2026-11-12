import { describe, expect, it } from "vitest";
import { createApp, compress, escapeHtml, html, htmlResponse, rawHtml, serveStatic } from "./index";
import { Fragment, jsx, jsxs } from "./jsx-runtime";

const req = (path: string, init?: RequestInit) => new Request("https://example.test" + path, init);

describe("serveStatic", () => {
  it("resolves paths through an injected asset loader", async () => {
    const app = createApp();
    const paths: string[] = [];
    app.get("/assets/*", serveStatic({
      root: "/public",
      fetch: (path) => { paths.push(path); return new Response("asset"); },
    }));
    expect(await (await app.fetch(req("/assets/app.js"), undefined)).text()).toBe("asset");
    expect(paths).toEqual(["/public/assets/app.js"]);
  });
  it("returns 404 for missing assets and blocks encoded traversal", async () => {
    const app = createApp();
    app.get("/assets/*", serveStatic({ fetch: () => undefined }));
    expect((await app.fetch(req("/assets/missing"), undefined)).status).toBe(404);
    expect((await app.fetch(req("/assets/%2e%2e%2fsecret"), undefined)).status).toBe(403);
  });
});

describe("compress", () => {
  it("gzip-compresses eligible responses and preserves headers", async () => {
    const app = createApp();
    app.use(compress());
    app.get("/", () => new Response("hello world", { headers: { "content-type": "text/plain" } }));
    const response = await app.fetch(req("/", { headers: { "accept-encoding": "gzip" } }), undefined);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    const decompressed = response.body!.pipeThrough(new DecompressionStream("gzip"));
    expect(await new Response(decompressed).text()).toBe("hello world");
  });
  it("does not compress when encoding is absent or response forbids transformation", async () => {
    const app = createApp();
    app.use(compress());
    app.get("/", () => new Response("plain", { headers: { "cache-control": "no-transform" } }));
    expect((await app.fetch(req("/", { headers: { "accept-encoding": "gzip" } }), undefined)).headers.has("content-encoding")).toBe(false);
    expect((await app.fetch(req("/"), undefined)).headers.has("content-encoding")).toBe(false);
  });
});

describe("html and jsx", () => {
  it("escapes interpolated HTML and supports explicitly trusted fragments", async () => {
    expect(escapeHtml('<img src="x">&')).toBe("&lt;img src=&quot;x&quot;&gt;&amp;");
    const result = html`<main>${"<script>alert(1)</script>"}${rawHtml("<b>safe</b>")}</main>`;
    const response = htmlResponse(result);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("<main>&lt;script&gt;alert(1)&lt;/script&gt;<b>safe</b></main>");
  });
  it("renders JSX attributes, children, components and fragments safely", async () => {
    const element = jsxs("main", {
      className: "page",
      children: [
        jsx("input", { disabled: true, value: '"bad"' }),
        jsx("p", { children: "<script>" }),
        jsx(({ title }) => jsx("h1", { children: title }), { title: "Hi" }),
        jsx(Fragment, { children: ["A", "B"] }),
      ],
    });
    const output = await htmlResponse(element).text();
    expect(output).toContain('class="page"');
    expect(output).toContain('value="&quot;bad&quot;"');
    expect(output).toContain("&lt;script&gt;");
    expect(output).toContain("<h1>Hi</h1>AB");
  });
});
