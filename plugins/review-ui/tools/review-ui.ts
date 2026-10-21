#!/usr/bin/env bun
// The Review UI command: a read-only view of a project's AI-DLC work in the
// browser, served on this machine only.
//
//   bun <harness-dir>/tools/review-ui.ts serve [--project-dir <path>]
//
// It writes nothing anywhere: not in the project, not in the home folder, and
// never the active-space or active-intent cursors.
import { basename, relative, resolve } from "node:path";

export const BUN_MESSAGE = "Review UI needs Bun 1.3.8 or newer: https://bun.sh";
const MINIMUM_BUN = [1, 3, 8];

/** The message to stop with when this runtime cannot run the Review UI, or null when it can. */
export function runtimeProblem(version: string | undefined, markdown: unknown): string | null {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  let recent = false;
  if (parts) {
    const [major, minor, patch] = parts.slice(1).map(Number);
    const [needMajor, needMinor, needPatch] = MINIMUM_BUN;
    recent = major !== needMajor ? major > needMajor : minor !== needMinor ? minor > needMinor : patch >= needPatch;
  }
  // Questions files are read through Bun.markdown.render, documents through Bun.markdown.react.
  const parser = markdown as { render?: unknown; react?: unknown } | undefined;
  const renders = typeof parser?.render === "function" && typeof parser.react === "function";
  return recent && renders ? null : BUN_MESSAGE;
}

export function noWorkspaceMessage(from: string): string {
  return `No AI-DLC workspace found above ${from}; pass --project-dir <path>`;
}

export function usage(script: string): string {
  return [
    `Usage: bun ${script} serve [--project-dir <path>]`,
    "",
    "Shows a project's AI-DLC work in your browser, read-only, on this machine only.",
    "",
    "  serve                 Start it for the project here: the nearest folder, from here",
    "                        upward, that holds aidlc/spaces/.",
    "  --project-dir <path>  Start it for that project instead.",
    "  --help                Show this help.",
    "",
    "REVIEW_UI_PORT picks the port. Unset, it takes the first free one from 4790 to 4799,",
    "then any free port; REVIEW_UI_PORT=0 asks for any free port.",
  ].join("\n");
}

type Parsed = { help: true } | { projectDir: string | null } | { error: string };

export function parseArgs(args: string[]): Parsed {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  if (args[0] !== "serve") return { error: args.length === 0 ? "Name a command: serve." : `Unknown command: ${args[0]}.` };
  let projectDir: string | null = null;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--project-dir" && index + 1 < args.length) projectDir = args[++index];
    else if (arg.startsWith("--project-dir=") && arg.length > "--project-dir=".length) projectDir = arg.slice("--project-dir=".length);
    else return { error: `Unknown option: ${arg}.` };
  }
  return { projectDir };
}

async function main(): Promise<void> {
  const script = relative(process.cwd(), process.argv[1] ?? "review-ui.ts") || "review-ui.ts";
  const problem = runtimeProblem(globalThis.Bun?.version, globalThis.Bun?.markdown);
  if (problem) {
    console.error(problem);
    process.exit(2);
  }
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    console.log(usage(script));
    return;
  }
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${usage(script)}`);
    process.exit(2);
  }
  // Loaded only now, so a runtime too old to load them still gets the sentence above.
  const { findProjectDir } = await import("./review-ui/workspace.ts");
  const { start } = await import("./review-ui/serve.ts");
  const from = parsed.projectDir === null ? process.cwd() : resolve(process.cwd(), parsed.projectDir);
  const projectDir = findProjectDir(from);
  if (!projectDir) {
    console.error(noWorkspaceMessage(from));
    process.exit(2);
  }
  console.log(`Reading ${projectDir}`);
  const running = start(projectDir, process.env);
  if ("error" in running) {
    console.error(running.error);
    process.exit(2);
  }
  console.log(`Review UI (read-only) for ${basename(projectDir)}: http://127.0.0.1:${running.port}/ (Ctrl+C stops it)`);
  const stop = (): void => {
    running.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.main) await main();
