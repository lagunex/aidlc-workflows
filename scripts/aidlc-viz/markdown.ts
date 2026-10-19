// Renders artifact Markdown to HTML for the browser. Artifact text is
// untrusted (it can quote anything a person or document said), so:
// - raw HTML is parsed as text, and every text chunk is escaped;
// - a link or image whose URL is not http(s), mailto, or relative keeps only
//   its text;
// - images render as links, so viewing an artifact never fetches anything.
// Bun.markdown is the repo's one Markdown parser (AGENTS.md, "Working on
// This Project"); this only supplies the HTML for each node.

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The URL when its scheme is http, https, or mailto, or it has none; null otherwise. */
export function safeHref(url: string): string | null {
  // Browsers ignore control characters and whitespace inside a scheme, so
  // "java\tscript:" must be judged as "javascript:".
  const collapsed = [...url]
    .filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f)
    .join("")
    .toLowerCase();
  const scheme = collapsed.match(/^([a-z][a-z0-9+.-]*):/);
  if (!scheme) return url;
  return ["http", "https", "mailto"].includes(scheme[1]) ? url : null;
}

const tag = (name: string, attrs = "") => (children: string) => `<${name}${attrs}>${children}</${name}>`;

const align = (meta?: { align?: string }) => (meta?.align ? ` class="align-${meta.align}"` : "");

export function renderMarkdown(source: string): string {
  return Bun.markdown.render(
    source,
    {
      heading: (children, meta) => tag(`h${meta.level}`)(children),
      paragraph: tag("p"),
      blockquote: tag("blockquote"),
      code: (children) => `<pre><code>${children}</code></pre>`,
      list: (children, meta) => (meta.ordered ? tag("ol")(children) : tag("ul")(children)),
      listItem: tag("li"),
      hr: () => "<hr>",
      table: tag("table", ' class="md-table"'),
      thead: tag("thead"),
      tbody: tag("tbody"),
      tr: tag("tr"),
      th: (children, meta) => tag("th", align(meta))(children),
      td: (children, meta) => tag("td", align(meta))(children),
      html: (children) => escapeHtml(children),
      strong: tag("strong"),
      emphasis: tag("em"),
      strikethrough: tag("del"),
      codespan: tag("code"),
      link: (children, meta) => {
        const href = safeHref(meta.href);
        return href === null ? children : `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow">${children}</a>`;
      },
      image: (children, meta) => {
        const href = safeHref(meta.src);
        const text = children || escapeHtml(meta.src);
        return href === null ? text : `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow">${text}</a>`;
      },
      text: (text) => escapeHtml(text),
    },
    { noHtmlBlocks: true, noHtmlSpans: true, tasklists: false },
  );
}
