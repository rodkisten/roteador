import { escapeHtml, htmlResponse, rawHtml, type HtmlFragment } from "./web";

export { htmlResponse };
export type JSXNode = HtmlFragment | string | number | null | undefined | boolean | JSXNode[];
export namespace JSX {
  export type Element = HtmlFragment;
  export interface IntrinsicElements { [element: string]: Record<string, unknown> }
  export interface ElementChildrenAttribute { children: {} }
}
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
function render(value: unknown): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (typeof value === "object" && "__html" in value) return (value as HtmlFragment).__html;
  return escapeHtml(value);
}
export function jsx(type: string | ((props: Record<string, unknown>) => JSXNode), props: Record<string, unknown> | null): HtmlFragment {
  const p = props ?? {};
  if (typeof type === "function") return rawHtml(render(type(p)));
  if (!/^[a-zA-Z][a-zA-Z0-9:-]*$/.test(type)) throw new TypeError("Invalid HTML element");
  const attributes = Object.entries(p).flatMap(([key, value]) => {
    if (key === "children" || key === "key" || key === "ref" || key.startsWith("on") || value == null || value === false) return [];
    const name = key === "className" ? "class" : key === "htmlFor" ? "for" : key;
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(name)) return [];
    if (value === true) return [name];
    return [`${name}="${escapeHtml(value)}"`];
  }).join(" ");
  const opening = `<${type}${attributes ? " " + attributes : ""}>`;
  return rawHtml(voidTags.has(type) ? opening : opening + render(p.children) + `</${type}>`);
}
export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = ({ children }: { children?: JSXNode }) => rawHtml(render(children));
