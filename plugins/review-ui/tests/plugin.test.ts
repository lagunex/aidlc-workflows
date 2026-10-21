// The review-ui plugin as a plugin: it validates and composes like any AI-DLC
// plugin, and its server answers from the composed copy as it does from the
// plugin folder, because every asset resolves from the module's own folder. No
// file of it, fixtures included, carries private data: an account number, an
// email address outside the example domains, a home or workspace path, a host
// name or a company's internal name.
//
// It also stays independent of the engine it shows. The code under tools/
// imports only node: built-ins and its own files, starts no other program,
// listens only through Bun.serve(serveOptions(...)), whose hostname is
// 127.0.0.1, and names no engine file; the one exception is the hidden-path
// list in workspace.ts, which is data the confinement checks against. Every
// extension Bun loads as a module is read, and tools/ holds no other kind of
// file than the ones these checks read. The page loads nothing from the
// internet, inserts HTML in one place only (the reader, which shows the
// document the server rendered), creates no element that runs, loads or styles
// content, and sets no inline styles or handlers, through its el() builder or
// otherwise. The import, name and page-safety checks read each file with the
// TypeScript parser, so a word in a comment never counts; the internet check
// also reads every file of public/ as text, comments included.
//
// Run: bun test plugins/review-ui/tests/plugin.test.ts

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ts from "typescript";
import {
  type ComposedPluginFixture,
  composePluginFixture,
  validatePluginContent,
} from "../../../tests/harness/plugin-kit.ts";
import { NATIVE_FIXTURE_SETUP_TIMEOUT_MS } from "../../../tests/harness/test-budget.ts";

setDefaultTimeout(NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_ROOT = join(PLUGIN_ROOT, "tools");
const PUBLIC_ROOT = join(TOOLS_ROOT, "review-ui", "public");
const FIXTURE = join(PLUGIN_ROOT, "tests", "fixtures", "aidlc-ui");
const MANIFEST = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".aidlc-plugin", "plugin.json"), "utf-8")) as {
  version: string;
  description: string;
  dependencies: string[];
  aidlc: { contributes: Record<string, string> };
};

function posix(path: string): string {
  return path.split(sep).join("/");
}

/** Every file below root, as a sorted POSIX path relative to it. */
function filesUnder(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else out.push(posix(relative(root, path)));
    }
  };
  if (existsSync(root)) visit(root);
  return out.sort();
}

/** A file's extension with its dot, lower-cased; "" when it has none. */
function extensionOf(rel: string): string {
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

// Every extension Bun loads as a module, each read with its own script kind,
// so a module under any of them meets every check below.
const SCRIPT_KINDS = new Map<string, ts.ScriptKind>([
  [".ts", ts.ScriptKind.TS],
  [".mts", ts.ScriptKind.TS],
  [".cts", ts.ScriptKind.TS],
  [".tsx", ts.ScriptKind.TSX],
  [".js", ts.ScriptKind.JS],
  [".mjs", ts.ScriptKind.JS],
  [".cjs", ts.ScriptKind.JS],
  [".jsx", ts.ScriptKind.JSX],
]);

// What the server serves from public/ besides index.html (workspace.ts's asset types).
const PAGE_ASSET_EXTENSIONS = new Set([".js", ".css", ".txt"]);

const isModule = (rel: string): boolean => SCRIPT_KINDS.has(extensionOf(rel));

interface Source {
  /** The path from the plugin root, for messages. */
  label: string;
  path: string;
  browser: boolean;
  file: ts.SourceFile;
}

function readSource(root: string, rel: string, browser: boolean): Source {
  const path = join(root, ...rel.split("/"));
  const label = posix(relative(PLUGIN_ROOT, path));
  const kind = SCRIPT_KINDS.get(extensionOf(rel));
  const file = ts.createSourceFile(label, readFileSync(path, "utf-8"), ts.ScriptTarget.Latest, true, kind);
  return { label, path, browser, file };
}

const SERVER_SOURCES = filesUnder(TOOLS_ROOT)
  .filter((rel) => isModule(rel) && !rel.startsWith("review-ui/public/"))
  .map((rel) => readSource(TOOLS_ROOT, rel, false));
const BROWSER_SOURCES = filesUnder(PUBLIC_ROOT)
  .filter(isModule)
  .map((rel) => readSource(PUBLIC_ROOT, rel, true));
const ALL_SOURCES = [...SERVER_SOURCES, ...BROWSER_SOURCES];

function eachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => eachNode(child, visit));
}

function where(source: Source, node: ts.Node): string {
  const { line } = source.file.getLineAndCharacterOfPosition(node.getStart(source.file));
  return `${source.label}:${line + 1}`;
}

/** The text of a string-like literal; a regular expression counts, without its escapes. */
function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text;
  }
  if (ts.isRegularExpressionLiteral(node)) return node.text.replace(/\\/g, "");
  return null;
}

/** The member a property or element access names, when it names one literally. */
function memberName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return literalText(node.argumentExpression);
  return null;
}

/** A property's name when it is written out: an identifier or a string. */
function staticName(property: ts.ObjectLiteralElementLike): string | null {
  const name = property.name;
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null;
}

function insideFunction(node: ts.Node): boolean {
  for (let up = node.parent; up; up = up.parent) {
    if (ts.isFunctionLike(up)) return true;
  }
  return false;
}

/** The function declaration a node sits in, as "<file>#<name>", or null. */
function enclosingFunction(source: Source, node: ts.Node): string | null {
  for (let up = node.parent; up; up = up.parent) {
    if (ts.isFunctionDeclaration(up) && up.name) return `${source.label}#${up.name.text}`;
  }
  return null;
}

/** Where a top-level const's value sits in a file. */
function constValueSpan(file: ts.SourceFile, name: string, exported: boolean): { start: number; end: number } | null {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (exported && !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
        return { start: declaration.initializer.getStart(file), end: declaration.initializer.getEnd() };
      }
    }
  }
  return null;
}

// Text that would identify a person's machine or a company's own systems. The
// fixtures are copies of real records, so they are checked with everything
// else before the folder is published; this list is the one place the words
// may appear.
const PRIVATE_WORDS = ["/home/", "/users/", "/local/home/", "/workplace/", "dev-dsk-", "amazon", "amzn", "cloudwatch", "midway", "isengard"];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Twelve digits on their own, the way an account number is written; inside a
// longer run of hex digits they are part of a hash, and UUIDs are blanked first.
const TWELVE_DIGITS = /(?<![0-9a-f])\d{12}(?![0-9a-f])/gi;
const EMAIL = /[\w.%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi;
// The domains kept for examples and tests (RFC 2606, RFC 6761).
const EXAMPLE_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|[a-z0-9-]+\.(?:example|test|invalid|localhost))$/i;

/** What in a text must not be published, each as "<line>: <what>". */
function privateData(text: string): string[] {
  const found: Array<{ at: number; what: string }> = [];
  const lower = text.toLowerCase();
  for (const word of PRIVATE_WORDS) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) found.push({ at, what: `names ${word}` });
  }
  const blanked = text.replace(UUID, (uuid) => " ".repeat(uuid.length));
  for (const match of blanked.matchAll(TWELVE_DIGITS)) found.push({ at: match.index, what: `has the number ${match[0]}` });
  for (const match of text.matchAll(EMAIL)) {
    if (!EXAMPLE_DOMAIN.test(match[1])) found.push({ at: match.index, what: `has the address ${match[0]}` });
  }
  return found.map(({ at, what }) => `${text.slice(0, at).split("\n").length}: ${what}`);
}

interface ModuleReference {
  node: ts.Node;
  /** Null when the module is named by anything but a string literal. */
  specifier: string | null;
}

/** Every module a file names: import and export-from declarations, import(), import types, import = require. */
function moduleReferences(source: Source): ModuleReference[] {
  const found: ModuleReference[] = [];
  const specifier = (node: ts.Node | undefined): string | null =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
  eachNode(source.file, (node) => {
    if (ts.isImportDeclaration(node)) {
      found.push({ node, specifier: specifier(node.moduleSpecifier) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      found.push({ node, specifier: specifier(node.moduleSpecifier) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      found.push({ node, specifier: specifier(node.moduleReference.expression) });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      found.push({ node, specifier: specifier(node.arguments[0]) });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      found.push({ node, specifier: specifier(node.argument.literal) });
    }
  });
  return found;
}

// Built-ins the server has no use for: they start other programs, run code
// that is not one of its modules, or open sockets beside its one listener.
const REFUSED_BUILTINS = new Map([
  ["node:child_process", "starts other programs"],
  ["node:cluster", "starts other programs"],
  ["node:worker_threads", "runs code beside the plugin's modules"],
  ["node:vm", "runs code beside the plugin's modules"],
  ["node:net", "opens sockets; the one listener is Bun.serve in serve.ts"],
  ["node:http", "opens sockets; the one listener is Bun.serve in serve.ts"],
  ["node:https", "opens sockets; the one listener is Bun.serve in serve.ts"],
  ["node:http2", "opens sockets; the one listener is Bun.serve in serve.ts"],
  ["node:dgram", "opens sockets; the one listener is Bun.serve in serve.ts"],
  ["node:tls", "opens sockets; the one listener is Bun.serve in serve.ts"],
]);

function specifierProblem(source: Source, specifier: string | null): string | null {
  if (specifier === null) return "names a module with something other than a string literal";
  if (specifier.startsWith("node:")) {
    if (source.browser) return `imports ${specifier}, which a browser cannot load`;
    const refused = REFUSED_BUILTINS.get(specifier);
    return refused ? `imports ${specifier}, which ${refused}` : null;
  }
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return `imports ${specifier}, which is neither a node: built-in nor a file of the plugin`;
  }
  // The page can load only what the server serves, which is public/.
  const root = source.browser ? PUBLIC_ROOT : TOOLS_ROOT;
  const target = resolve(dirname(source.path), specifier);
  const inside = relative(root, target);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    return `imports ${specifier}, which is outside ${posix(relative(PLUGIN_ROOT, root))}/`;
  }
  if (!existsSync(target) || !statSync(target).isFile()) return `imports ${specifier}, which is not a file`;
  // The kinds of module the "holds only" test allows, so an import cannot reach a file it refuses.
  const own = source.browser ? ".js" : ".ts";
  if (extensionOf(specifier) !== own) return `imports ${specifier}; the plugin's own modules here are ${own} files`;
  return null;
}

/** `Bun`, or `globalThis.Bun` and the like: the object Bun's own APIs hang on. */
function isBunObject(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === "Bun";
  return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberName(node) === "Bun";
}

/** The one listener: serve.ts hands Bun.serve the options serveOptions() builds, and nothing else. */
function isTheServer(source: Source, access: ts.Node): boolean {
  const call = access.parent;
  if (source.label !== "tools/review-ui/serve.ts" || !ts.isCallExpression(call) || call.expression !== access) return false;
  const [options, ...rest] = call.arguments;
  return (
    rest.length === 0 &&
    options !== undefined &&
    ts.isCallExpression(options) &&
    ts.isIdentifier(options.expression) &&
    options.expression.text === "serveOptions"
  );
}

// What the engine keeps for itself: the plugin reads none of it, so it names
// none of it.
const ENGINE_NAMES = [
  "stage-graph.json",
  "scope-grid.json",
  "harness.json",
  "aidlc-lib",
  ".aidlc-engine",
  ".aidlc-sessions",
  "active-memory",
  ".review-ui",
  "runtime-graph.json",
  "tools/data",
];

/** Where the exported HIDDEN_NAMES constant's value sits in workspace.ts, the one place engine names may appear. */
function hiddenNamesSpan(source: Source): { start: number; end: number } | null {
  return source.label === "tools/review-ui/workspace.ts" ? constValueSpan(source.file, "HIDDEN_NAMES", true) : null;
}

// The page's two builders: el() takes its caller's tag and attributes, and
// icon() sets the attributes of its own object literal.
const STORE = "tools/review-ui/public/store.js";
const ELEMENT_BUILDER = `${STORE}#el`;
const ATTRIBUTE_BUILDERS = new Set([ELEMENT_BUILDER, "tools/review-ui/public/icons.js#icon"]);

interface Named {
  node: ts.Node;
  name: string;
}

interface BuilderCalls {
  /** Each el() call, with the top-level attribute names it passes; el()'s "on" and "dataset" maps hold no attributes. */
  calls: Array<{ call: ts.CallExpression; names: Named[] }>;
  /** Uses of el() whose attributes cannot be read here. */
  unreadable: string[];
}

/** Every call of store.js's el() in a file, under whatever name the file imports it. */
function builderCalls(source: Source): BuilderCalls {
  const direct = new Set<string>(source.label === STORE ? ["el"] : []);
  const namespaces = new Set<string>();
  for (const statement of source.file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!/(?:^|\/)store\.js$/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else if (bindings) {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === "el") direct.add(element.name.text);
      }
    }
  }
  const result: BuilderCalls = { calls: [], unreadable: [] };
  eachNode(source.file, (node) => {
    const parent = node.parent;
    const named =
      ts.isIdentifier(node) &&
      direct.has(node.text) &&
      !(ts.isPropertyAccessExpression(parent) && parent.name === node) &&
      !(ts.isFunctionDeclaration(parent) && parent.name === node) &&
      !ts.isImportSpecifier(parent);
    const throughNamespace =
      ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && node.name.text === "el";
    if (!named && !throughNamespace) return;
    if (!ts.isCallExpression(parent) || parent.expression !== node) {
      result.unreadable.push(`${where(source, node)} uses el() other than by calling it`);
      return;
    }
    const attrs = parent.arguments[1];
    const names: Named[] = [];
    result.calls.push({ call: parent, names });
    if (attrs === undefined || attrs.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(attrs) && attrs.text === "undefined")) return;
    if (!ts.isObjectLiteralExpression(attrs)) {
      result.unreadable.push(`${where(source, attrs)} passes el() attributes that are not an object literal`);
      return;
    }
    for (const property of attrs.properties) {
      const name = ts.isSpreadAssignment(property) ? null : staticName(property);
      if (name === null) result.unreadable.push(`${where(source, property)} passes el() an attribute whose name is not written out`);
      else names.push({ node: property, name });
    }
  });
  return result;
}

/** A setAttribute-style call and the argument that names the attribute; null when the node is not one. */
function attributeCall(node: ts.Node): { call: ts.CallExpression; name: ts.Expression | undefined } | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text;
  if (method === "setAttributeNS" || method === "createAttributeNS") return { call: node, name: node.arguments[1] };
  if (["setAttribute", "toggleAttribute", "createAttribute"].includes(method)) return { call: node, name: node.arguments[0] };
  return null;
}

/** Every attribute name the page sets: el() attributes, written-out setAttribute names, and the keys in the builders. */
function attributeNames(source: Source): Named[] {
  const found = builderCalls(source).calls.flatMap(({ names }) => names);
  eachNode(source.file, (node) => {
    const text = literalText(attributeCall(node)?.name);
    if (text !== null) found.push({ node, name: text });
    if (ts.isObjectLiteralExpression(node) && ATTRIBUTE_BUILDERS.has(enclosingFunction(source, node) ?? "")) {
      for (const property of node.properties) {
        const name = staticName(property);
        if (name !== null) found.push({ node: property, name });
      }
    }
  });
  return found;
}

/** Every element the page creates, with its tag when it is written out. */
function createdTags(source: Source): Array<{ node: ts.Node; tag: string | null }> {
  const found: Array<{ node: ts.Node; tag: string | null }> = builderCalls(source).calls.map(({ call }) => ({
    node: call,
    tag: literalText(call.arguments[0]),
  }));
  eachNode(source.file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const method = node.expression.name.text;
    if (method !== "createElement" && method !== "createElementNS") return;
    // el() creates what its caller names, and its calls are listed above.
    if (enclosingFunction(source, node) === ELEMENT_BUILDER) return;
    found.push({ node, tag: literalText(method === "createElement" ? node.arguments[0] : node.arguments[1]) });
  });
  return found;
}

// Elements that run, load or style content, or change how the page resolves
// its links.
const ACTIVE_TAGS = new Set(["script", "style", "iframe", "frame", "frameset", "object", "embed", "base", "link", "meta"]);

// Members that put HTML, or a document built from it, into the page.
const HTML_SINKS = new Set([
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "createContextualFragment",
  "setHTMLUnsafe",
  "parseHTMLUnsafe",
  "srcdoc",
]);

/** The HTML sinks a browser file uses, each with where it is. */
function htmlSinks(source: Source): Array<{ node: ts.Node; what: string }> {
  const found: Array<{ node: ts.Node; what: string }> = [];
  eachNode(source.file, (node) => {
    const name = memberName(node);
    if (name && HTML_SINKS.has(name)) found.push({ node, what: name });
    if ((name === "write" || name === "writeln") && ts.isPropertyAccessExpression(node)) {
      const target = node.expression;
      const onDocument =
        (ts.isIdentifier(target) && target.text === "document") ||
        (ts.isPropertyAccessExpression(target) && target.name.text === "document");
      if (onDocument) found.push({ node, what: `document.${name}` });
    }
    if (ts.isIdentifier(node) && node.text === "DOMParser") found.push({ node, what: "DOMParser" });
  });
  for (const { node, name } of attributeNames(source)) {
    if (name.toLowerCase() === "srcdoc") found.push({ node, what: "a srcdoc attribute" });
  }
  return found;
}

describe("review-ui plugin content", () => {
  test("passes the plugin content validator", () => {
    expect(validatePluginContent(PLUGIN_ROOT)).toEqual([]);
  });

  test("ships tools only, built on core, and names the command it ships", () => {
    expect(MANIFEST.aidlc.contributes).toEqual({ tools: "tools/" });
    expect(MANIFEST.dependencies).toEqual(["core"]);
    for (const dir of ["stages", "sensors", "contributions", "scopes", "agents", "knowledge", "memory", "hooks"]) {
      expect(existsSync(join(PLUGIN_ROOT, dir)), `${dir}/`).toBe(false);
    }
    expect(MANIFEST.description).toContain("bun <harness-dir>/tools/review-ui.ts serve");
  });

  test("has its command, its server and its page", () => {
    const shipped = filesUnder(TOOLS_ROOT);
    for (const rel of [
      "review-ui.ts",
      "review-ui/workspace.ts",
      "review-ui/server.ts",
      "review-ui/serve.ts",
      "review-ui/types.ts",
      "review-ui/public/index.html",
      "review-ui/public/app.js",
      "review-ui/public/document.js",
      "review-ui/public/icons.js",
      "review-ui/public/FLUENT-ICONS-LICENSE.txt",
    ]) {
      expect(shipped, rel).toContain(rel);
    }
  });

  test("ships nothing under tools/data/ and no core name, such as tools/aidlc-review-ui*", () => {
    const shipped = filesUnder(TOOLS_ROOT);
    expect(shipped.filter((rel) => rel.startsWith("data/") || rel.startsWith("aidlc-"))).toEqual([]);
    // Everything else sits under the plugin's own name, so it cannot land on
    // another plugin's file either.
    expect(shipped.filter((rel) => rel !== "review-ui.ts" && !rel.startsWith("review-ui/"))).toEqual([]);
  });

  test("carries no private data in any file, fixtures included", () => {
    const self = fileURLToPath(import.meta.url);
    const selfText = readFileSync(self, "utf-8");
    const list = constValueSpan(ts.createSourceFile(self, selfText, ts.ScriptTarget.Latest, true), "PRIVATE_WORDS", false);
    expect(list, "this file's PRIVATE_WORDS").not.toBeNull();
    const problems: string[] = [];
    for (const rel of filesUnder(PLUGIN_ROOT)) {
      const path = join(PLUGIN_ROOT, ...rel.split("/"));
      let text = readFileSync(path, "utf-8");
      if (path === self && list) {
        text = `${text.slice(0, list.start)}${text.slice(list.start, list.end).replace(/[^\n]/g, " ")}${text.slice(list.end)}`;
      }
      for (const problem of privateData(text)) problems.push(`${rel}:${problem}`);
    }
    expect(problems).toEqual([]);
  });
});

describe("review-ui plugin independence", () => {
  test("tools/ holds only files its checks read: .ts modules for the server; index.html, .js, .css and .txt for the page", () => {
    const other = filesUnder(TOOLS_ROOT).filter((rel) =>
      rel.startsWith("review-ui/public/")
        ? rel !== "review-ui/public/index.html" && !PAGE_ASSET_EXTENSIONS.has(extensionOf(rel))
        : extensionOf(rel) !== ".ts",
    );
    expect(other).toEqual([]);
  });

  test("imports only node: built-ins and its own files", () => {
    const problems: string[] = [];
    for (const source of ALL_SOURCES) {
      for (const { node, specifier } of moduleReferences(source)) {
        const problem = specifierProblem(source, specifier);
        if (problem) problems.push(`${where(source, node)} ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("loads no module at run time by name, starts no program and opens no second listener", () => {
    const problems: string[] = [];
    const bunMembers = new Set(["spawn", "spawnSync", "$", "listen", "serve", "udpSocket"]);
    let servers = 0;
    for (const source of ALL_SOURCES) {
      eachNode(source.file, (node) => {
        const at = (what: string): void => {
          problems.push(`${where(source, node)} ${what}`);
        };
        if (ts.isIdentifier(node) && (node.text === "require" || node.text === "createRequire")) at(`uses ${node.text}`);
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
          at("uses import = require()");
        }
        if (ts.isIdentifier(node) && node.text === "createServer") at("uses createServer");
        if (ts.isPropertyAccessExpression(node) && node.name.text === "listen") at("calls .listen");
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /^(?:Shared)?Worker$/.test(node.expression.text)) {
          at(`starts a ${node.expression.text}`);
        }
        if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isBunObject(node.expression)) {
          const name = memberName(node);
          if (name === null) at("uses Bun[...] with a computed name");
          else if (name === "serve" && isTheServer(source, node)) servers += 1;
          else if (bunMembers.has(name)) at(`uses Bun.${name}`);
        }
        if (ts.isVariableDeclaration(node) && node.initializer && isBunObject(node.initializer)) {
          if (!ts.isObjectBindingPattern(node.name)) at("gives Bun another name");
          else {
            for (const element of node.name.elements) {
              const name = element.propertyName ?? element.name;
              if (ts.isIdentifier(name) && bunMembers.has(name.text)) at(`takes ${name.text} from Bun`);
            }
          }
        }
        const text = literalText(node);
        if (text !== null && (text.includes("0.0.0.0") || text === "::" || text === "[::]")) {
          at(`names the any-address ${JSON.stringify(text)}`);
        }
      });
    }
    expect(problems).toEqual([]);
    expect(servers, "Bun.serve(serveOptions(...)) calls in serve.ts").toBe(1);
  });

  test("its one listener's options bind 127.0.0.1", async () => {
    const { createHandler } = (await import("../tools/review-ui/server.ts")) as ServerModule;
    const { serveOptions } = (await import("../tools/review-ui/serve.ts")) as ServeModule;
    const options = serveOptions(createHandler({ projectDir: FIXTURE, version: MANIFEST.version }), 0);
    expect(options.hostname).toBe("127.0.0.1");
  });

  test("names no engine file, except in workspace.ts's HIDDEN_NAMES", () => {
    const problems: string[] = [];
    for (const source of ALL_SOURCES) {
      const exempt = hiddenNamesSpan(source);
      eachNode(source.file, (node) => {
        const text = literalText(node)?.toLowerCase();
        if (text === undefined || text === null) return;
        if (exempt && node.getStart(source.file) >= exempt.start && node.getEnd() <= exempt.end) return;
        for (const name of ENGINE_NAMES) {
          if (text.includes(name)) problems.push(`${where(source, node)} names ${name}`);
        }
      });
    }
    expect(problems).toEqual([]);
  });
});

describe("review-ui page", () => {
  test("inserts HTML only in the reader: one innerHTML assignment, in document.js", () => {
    const outside: string[] = [];
    const reader: Array<{ source: Source; node: ts.Node; what: string }> = [];
    for (const source of BROWSER_SOURCES) {
      for (const sink of htmlSinks(source)) {
        if (source.label === "tools/review-ui/public/document.js") reader.push({ source, ...sink });
        else outside.push(`${where(source, sink.node)} uses ${sink.what}`);
      }
    }
    expect(outside).toEqual([]);
    const found = reader.map(({ source, node, what }) => `${where(source, node)} ${what}`);
    expect(found.length, `HTML sinks in document.js: ${found.join(", ") || "none"}`).toBe(1);
    const [only] = reader;
    expect(only.what).toBe("innerHTML");
    const assignment = only.node.parent;
    const assigned =
      ts.isBinaryExpression(assignment) &&
      assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      assignment.left === only.node;
    expect(assigned, `${where(only.source, only.node)} assigns innerHTML`).toBe(true);
    expect(insideFunction(only.node), `${where(only.source, only.node)} sits in a function`).toBe(true);
  });

  test("names every attribute it sets, so the checks here can read them", () => {
    const problems: string[] = [];
    for (const source of BROWSER_SOURCES) {
      problems.push(...builderCalls(source).unreadable);
      eachNode(source.file, (node) => {
        const call = attributeCall(node);
        if (call && literalText(call.name) === null && !ATTRIBUTE_BUILDERS.has(enclosingFunction(source, node) ?? "")) {
          problems.push(`${where(source, node)} sets an attribute whose name is not written out`);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  test("sets no inline styles", () => {
    const problems: string[] = [];
    const styleMembers = new Set(["style", "cssText", "attributeStyleMap"]);
    for (const source of BROWSER_SOURCES) {
      eachNode(source.file, (node) => {
        const name = memberName(node);
        if (name && styleMembers.has(name)) problems.push(`${where(source, node)} uses .${name}`);
      });
      for (const { node, name } of attributeNames(source)) {
        if (name.toLowerCase() === "style") problems.push(`${where(source, node)} sets a style attribute`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("sets no inline event handlers", () => {
    const problems: string[] = [];
    for (const source of BROWSER_SOURCES) {
      for (const { node, name } of attributeNames(source)) {
        if (/^on[a-z]+$/i.test(name)) problems.push(`${where(source, node)} sets the ${name} attribute, a handler run from text`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("creates no element that runs, loads or styles content", () => {
    const problems: string[] = [];
    for (const source of BROWSER_SOURCES) {
      for (const { node, tag } of createdTags(source)) {
        if (tag === null) problems.push(`${where(source, node)} creates an element whose tag is not written out`);
        else if (ACTIVE_TAGS.has(tag.toLowerCase())) problems.push(`${where(source, node)} creates a ${tag} element`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("the page shell has no inline script, style or handler, and names only files that ship", () => {
    const html = readFileSync(join(PUBLIC_ROOT, "index.html"), "utf-8");
    const problems: string[] = [];
    for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
      if (!/\ssrc\s*=/i.test(tag)) problems.push(`an inline script: ${tag}`);
    }
    if (/<style\b/i.test(html)) problems.push("a <style> element");
    for (const [, attribute] of html.matchAll(/\s(style|on[a-z]+)\s*=/gi)) problems.push(`the ${attribute} attribute`);
    if (/javascript:/i.test(html)) problems.push("a javascript: link");
    for (const [, ref] of html.matchAll(/<(?:script|link)\b[^>]*\s(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
      const path = ref.replace(/^\.?\//, "");
      const file = path.startsWith("assets/") ? join(PUBLIC_ROOT, ...path.slice("assets/".length).split("/")) : null;
      if (!file || !existsSync(file)) problems.push(`names ${ref}, which is not a file of public/`);
    }
    expect(problems).toEqual([]);
  });

  test("loads nothing from the internet", () => {
    const problems: string[] = [];
    for (const rel of filesUnder(PUBLIC_ROOT)) {
      const text = readFileSync(join(PUBLIC_ROOT, ...rel.split("/")), "utf-8");
      for (const [url] of text.matchAll(/https?:\/\/[^\s"'`<>()]*/g)) problems.push(`${rel}: ${url}`);
      for (const [url] of text.matchAll(/wss?:\/\/[\w[][^\s"'`<>()]*/g)) problems.push(`${rel}: ${url}`);
      if (/\.(?:html|css)$/.test(rel)) {
        for (const [ref] of text.matchAll(/(?:(?:src|href)\s*=\s*["']|url\(\s*["']?)\/\/[^\s"')]*/gi)) {
          problems.push(`${rel}: ${ref}`);
        }
      }
    }
    // A protocol-relative address, //host/path, in a script's strings; read
    // from the parsed file, since a // comment is not one.
    for (const source of BROWSER_SOURCES) {
      eachNode(source.file, (node) => {
        const text = literalText(node);
        if (text !== null && /^\/\/[\w[]/.test(text)) problems.push(`${where(source, node)} names ${text}`);
      });
    }
    expect(problems).toEqual([]);
  });
});

type ServerModule = typeof import("../tools/review-ui/server.ts");
type ServeModule = typeof import("../tools/review-ui/serve.ts");

describe("review-ui plugin composed into a Claude Code install", () => {
  let scratch = "";
  let fixture: ComposedPluginFixture | null = null;
  const composed = (): ComposedPluginFixture => {
    if (!fixture) throw new Error("the plugin was not composed");
    return fixture;
  };

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "aidlc-review-ui-plugin-"));
    fixture = composePluginFixture({ plugin: "review-ui", harness: "claude", projectDir: join(scratch, "project") });
  });

  afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test("composes with nothing dropped", () => {
    expect(composed().composeStatus).toBe(0);
    expect(composed().dropLogs).toBe("");
  });

  test("the build ships exactly the plugin's tools", () => {
    expect(filesUnder(join(composed().pluginBuilt, "tools"))).toEqual(filesUnder(TOOLS_ROOT));
  });

  test("every file under tools/ lands in .claude/tools/ unchanged", () => {
    const installed = join(composed().projectDir, ".claude", "tools");
    const differing: string[] = [];
    for (const rel of filesUnder(TOOLS_ROOT)) {
      const copy = join(installed, ...rel.split("/"));
      if (!existsSync(copy)) differing.push(`${rel} is missing`);
      else if (!readFileSync(copy).equals(readFileSync(join(TOOLS_ROOT, ...rel.split("/"))))) {
        differing.push(`${rel} differs`);
      }
    }
    expect(differing).toEqual([]);
  });

  test("the Fluent icons licence lands beside icons.js", () => {
    const publicDir = join(composed().projectDir, ".claude", "tools", "review-ui", "public");
    expect(existsSync(join(publicDir, "icons.js"))).toBe(true);
    const licence = readFileSync(join(publicDir, "FLUENT-ICONS-LICENSE.txt"), "utf-8");
    expect(licence).toContain("MIT License");
    expect(licence).toContain("Microsoft");
  });

  test("the composed server answers health and serves the page from its own folder", async () => {
    const { projectDir } = composed();
    const serverDir = join(projectDir, ".claude", "tools", "review-ui");
    // The composed copies, not the plugin folder's: each resolves its siblings
    // and public/ from where it sits.
    const { createHandler } = (await import(pathToFileURL(join(serverDir, "server.ts")).href)) as ServerModule;
    const { REVIEW_UI_VERSION } = (await import(pathToFileURL(join(serverDir, "serve.ts")).href)) as ServeModule;
    const port = 4790;
    const handler = createHandler({ projectDir, version: REVIEW_UI_VERSION });
    const peer = { requestIP: () => ({ address: "127.0.0.1" }), upgrade: () => false, port };
    const get = (path: string): Request =>
      new Request(`http://127.0.0.1:${port}${path}`, { headers: { host: `127.0.0.1:${port}` } });

    const health = handler.fetch(get("/api/health"), peer);
    expect(health?.status).toBe(200);
    expect(await health?.json()).toEqual({ ok: true, version: MANIFEST.version });

    const page = handler.fetch(get("/"), peer);
    expect(page?.status).toBe(200);
    expect(page?.headers.get("content-type") ?? "").toContain("text/html");
    expect(await page?.text()).toBe(readFileSync(join(serverDir, "public", "index.html"), "utf-8"));
  });
});
