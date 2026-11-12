import type { Context, Middleware } from "./index";

export type StaticOptions<Env> = {
  root?: string;
  fetch: (path: string, context: Context<Env>) => Response | undefined | Promise<Response | undefined>;
  notFound?: () => Response;
};

/** Fetch-native static handler. Supply an asset loader; no filesystem dependency. */
export function serveStatic<Env>(options: StaticOptions<Env>) {
  const root = (options.root ?? "/").replace(/\/$/, "");
  return async (context: Context<Env>): Promise<Response> => {
    const pathname = new URL(context.req.url).pathname;
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); }
    catch { return new Response("Bad Request", { status: 400 }); }
    const segments = decoded.split("/");
    if (segments.some((part) => part === "." || part === ".." || part.includes("\\") || part.includes("\0"))) {
      return new Response("Forbidden", { status: 403 });
    }
    const path = root + decoded;
    const result = await options.fetch(path, context);
    return result ?? options.notFound?.() ?? new Response("Not Found", { status: 404 });
  };
}

export type CompressionOptions = { encoding?: "gzip" | "deflate"; minimumBytes?: number };
/** Compresses eligible buffered/streamed responses with Web CompressionStream. */
export function compress<Env>(options: CompressionOptions = {}): Middleware<Env> {
  const encoding = options.encoding ?? "gzip";
  const minimum = options.minimumBytes ?? 0;
  return async ({ req }, next) => {
    const response = await next();
    if (!req.headers.get("accept-encoding")?.split(",").some((token) =>
      token.trim().split(";")[0] === encoding)) return response;
    if (!response.body || response.status === 204 || response.status === 304 ||
      response.headers.has("content-encoding") || response.headers.has("content-range") ||
      response.headers.get("cache-control")?.includes("no-transform") ||
      (Number(response.headers.get("content-length")) || 0) < minimum &&
      response.headers.has("content-length")) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-md5");
    headers.set("content-encoding", encoding);
    headers.set("vary", [...new Set([...(headers.get("vary") ?? "").split(",").map((v) => v.trim()).filter(Boolean), "Accept-Encoding"])].join(", "));
    const stream = response.body.pipeThrough(new CompressionStream(encoding));
    return new Response(stream, { status: response.status, statusText: response.statusText, headers });
  };
}

/** Escaped HTML template. Explicitly trusted fragments must be created via rawHtml(). */
export type HtmlFragment = { readonly __html: string };
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function rawHtml(value: string): HtmlFragment { return { __html: value }; }
function renderValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (value && typeof value === "object" && "__html" in value) return (value as HtmlFragment).__html;
  return escapeHtml(value);
}
export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlFragment {
  return rawHtml(strings.reduce((out, chunk, i) => out + chunk + (i < values.length ? renderValue(values[i]) : ""), ""));
}
export function htmlResponse(fragment: HtmlFragment | string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
  return new Response(typeof fragment === "string" ? fragment : fragment.__html, { ...init, headers });
}
