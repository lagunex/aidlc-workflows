// Renders a document for the reader. Document text is untrusted (it can quote
// anything a person or a tool wrote), so:
// - raw HTML shows as text; an HTML comment is dropped, as any reader hides it;
// - links keep http, https and mailto; a relative link to a file in the same
//   root (the record, or the codekb) opens in the app; any other relative link
//   is its text, with the target in a tooltip;
// - images show as links, so reading a document never fetches anything;
// - headings get ids "md-<slug>", unique in the document, so they never clash
//   with the app's own region ids.
// Bun.markdown is the one Markdown parser (AGENTS.md, "Working on This
// Project"); this only supplies the HTML for each node. It walks the element
// tree of Bun.markdown.react(), the one output that tells a hard line break
// (a "br" element) from a soft one: render() hands both over as a newline.
import { isRawHtmlChunk, neutralizeControlTags, stripTagMarks } from "./questions.ts";
import type { OutlineItem } from "./types.ts";
import { isHiddenAt } from "./workspace.ts";

export interface RenderContext {
  /** The document's project-relative path. */
  path: string;
  /** The project-relative path of the root it was read from (a record or a codekb). */
  root: string;
  /** Which kind of root that is; a record's top level holds the engine's own entries. */
  rootKind: "record" | "codekb";
}

export interface Rendered {
  html: string;
  outline: OutlineItem[];
}

/** A node of Bun.markdown.react()'s tree: text, a list of nodes, or an element. */
type MarkdownNode = string | number | boolean | null | undefined | MarkdownElement | MarkdownNode[];

interface MarkdownElement {
  type: unknown;
  props?: { children?: MarkdownNode; [prop: string]: unknown };
}

const ALIGNMENTS = new Set(["left", "center", "right"]);
// The anchors this renderer made inside a link's text (an image shows as a
// link). HTML has no anchor inside an anchor: the browser would split them,
// and the text would open the inner one.
const ANCHOR_TAG = /<a\b[^>]*>|<\/a>/g;
// Bun.markdown hands an email autolink, <a@b.c>, its bare address without the
// mailto: that Bun.markdown.html adds; its text is always that address. This
// is CommonMark's email autolink grammar.
const EMAIL_AUTOLINK =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function unescapeHtml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** The URL's scheme in lower case, or "" when it has none. */
function schemeOf(url: string): string {
  // Browsers ignore control characters and whitespace inside a scheme, so
  // "java\tscript:" must be judged as "javascript:".
  const collapsed = [...url]
    .filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f)
    .join("")
    .toLowerCase();
  return /^([a-z][a-z0-9+.-]*):/.exec(collapsed)?.[1] ?? "";
}

/** The URL when its scheme is http, https or mailto; null otherwise. */
export function safeHref(url: string): string | null {
  return ["http", "https", "mailto"].includes(schemeOf(url)) ? url : null;
}

/** A heading's id stem: letters and digits of any script, joined by hyphens. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/**
 * Where a relative link points, as a project-relative path, when it stays in
 * the root and names something that looks like a file; null otherwise.
 */
export function resolveRelative(href: string, context: RenderContext): string | null {
  const pathPart = href.split(/[?#]/)[0];
  if (!pathPart || pathPart.startsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const segments = context.path.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  const root = context.root.split("/");
  if (segments.length <= root.length || root.some((segment, index) => segments[index] !== segment)) return null;
  const rest = segments.slice(root.length);
  const recordRoot = context.rootKind === "record";
  if (rest.some((segment, depth) => isHiddenAt(segment, depth, recordRoot))) return null;
  if (!/\.[\p{L}\p{N}]{1,10}$/u.test(rest[rest.length - 1])) return null;
  return segments.join("/");
}

/** Raw inline HTML as the reader shows it: a comment hidden, a bare line break kept, any other tag as text. */
function rawInline(chunk: string): string {
  if (chunk.startsWith("<!--")) return "";
  if (/^<br\s*\/?>$/i.test(chunk)) return "<br>";
  return escapeHtml(chunk);
}

// Below this many levels of nesting the reader shows the rest of a branch as
// plain text: a document of thousands of nested lists or quotes would
// otherwise run the recursive walk out of stack and fail to open at all.
const MAX_DEPTH = 200;

/** A node's text, every element's tags left out. Iterative, so any depth is fine. */
function textOf(node: MarkdownNode): string {
  const parts: string[] = [];
  const pending: MarkdownNode[] = [node];
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === null || next === undefined || typeof next === "boolean") continue;
    if (typeof next === "string" || typeof next === "number") parts.push(String(next));
    else if (Array.isArray(next)) for (let index = next.length - 1; index >= 0; index--) pending.push(next[index]);
    else pending.push(next.props?.children);
  }
  return parts.join("");
}

export function renderMarkdown(source: string, context: RenderContext): Rendered {
  const outline: OutlineItem[] = [];
  const used = new Set<string>();
  // Where each stem's numbering goes on, so a document of many headings with
  // one name numbers each in one step instead of counting up from 1 again.
  const nextNumber = new Map<string, number>();
  const uniqueId = (text: string): string => {
    const stem = `md-${slugify(text)}`;
    let id = stem;
    let n = nextNumber.get(stem) ?? 1;
    while (used.has(id)) id = `${stem}-${n++}`;
    nextNumber.set(stem, n);
    used.add(id);
    return id;
  };
  // Code, a code block and a raw HTML block show their text as written.
  const literal = (node: MarkdownNode): string => escapeHtml(stripTagMarks(textOf(node)));
  const link = (href: string, children: string, title: unknown): string => {
    const written = href.trim();
    const target = !schemeOf(written) && children === escapeHtml(written) && EMAIL_AUTOLINK.test(written) ? `mailto:${written}` : written;
    const text = children.replace(ANCHOR_TAG, "");
    if (target.startsWith("#")) {
      let fragment = target.slice(1);
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        // An undecodable fragment is slugged as written.
      }
      return fragment ? `<a href="#md-${escapeHtml(slugify(fragment))}">${text}</a>` : children;
    }
    if (schemeOf(target)) {
      if (!safeHref(target)) return children;
      const titled = typeof title === "string" && title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(target)}"${titled} rel="noopener noreferrer nofollow" target="_blank">${text}</a>`;
    }
    const resolved = target.startsWith("//") ? null : resolveRelative(target, context);
    if (resolved) return `<a href="#" data-open-path="${escapeHtml(resolved)}">${text}</a>`;
    return `<span class="md-link" title="${escapeHtml(target)}">${children}</span>`;
  };
  const walk = (node: MarkdownNode, depth: number): string => {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") {
      const text = String(node);
      return isRawHtmlChunk(text) ? rawInline(text) : escapeHtml(stripTagMarks(text));
    }
    if (depth > MAX_DEPTH) return escapeHtml(stripTagMarks(textOf(node)));
    if (Array.isArray(node)) return node.map((child) => walk(child, depth + 1)).join("");
    const props = node.props ?? {};
    const inner = (): string => walk(props.children, depth + 1);
    const type = typeof node.type === "string" ? node.type : "";
    switch (type) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const html = inner();
        const text = unescapeHtml(html.replace(/<[^>]*>/g, "")).trim();
        const id = uniqueId(text);
        outline.push({ level: Number(type.slice(1)), text, id });
        return `<${type} id="${id}">${html}</${type}>`;
      }
      case "p":
      case "blockquote":
      case "ul":
      case "li":
      case "thead":
      case "tbody":
      case "tr":
      case "strong":
      case "em":
      case "del":
        return `<${type}>${inner()}</${type}>`;
      case "ol": {
        const start = props.start;
        return `<ol${typeof start === "number" && Number.isSafeInteger(start) && start !== 1 ? ` start="${start}"` : ""}>${inner()}</ol>`;
      }
      case "table":
        return `<table class="md-table">${inner()}</table>`;
      case "th":
      case "td": {
        const align = typeof props.align === "string" && ALIGNMENTS.has(props.align) ? ` class="align-${props.align}"` : "";
        return `<${type}${align}>${inner()}</${type}>`;
      }
      case "br":
        return "<br>";
      case "hr":
        return "<hr>";
      case "code":
        return `<code>${literal(props.children)}</code>`;
      case "pre": {
        const mermaid = typeof props.language === "string" && props.language.toLowerCase() === "mermaid";
        return `<pre${mermaid ? ' class="mermaid"' : ""}><code>${literal(props.children)}</code></pre>`;
      }
      case "html": {
        const block = literal(props.children);
        return /^\s*&lt;!--[\s\S]*--&gt;\s*$/.test(block) ? "" : `<pre class="md-raw-html"><code>${block}</code></pre>`;
      }
      case "a":
        return link(String(props.href ?? ""), inner(), props.title);
      case "img": {
        const src = String(props.src ?? "");
        const alt = typeof props.alt === "string" ? props.alt : "";
        return link(src, escapeHtml(stripTagMarks(alt || src)), props.title);
      }
      default:
        return inner();
    }
  };
  const tree = Bun.markdown.react(
    neutralizeControlTags(source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), { contained: true }),
    undefined,
    { tasklists: false },
  ) as unknown as MarkdownNode;
  return { html: walk(tree, 0), outline };
}

/** A text file as one preformatted block. */
export function renderText(source: string): string {
  return `<pre><code>${escapeHtml(source.replace(/\r\n?/g, "\n"))}</code></pre>`;
}
