#!/usr/bin/env bun
// Serves a read-only browser view of an AI-DLC workspace on loopback.
//
//   bun scripts/aidlc-viz/aidlc-viz.ts
//
// PORT (default 4178) picks the port. AIDLC_WORKSPACE_ROOT (default: the
// current directory) is the project to show, the directory holding `aidlc/`.
import { resolve } from "node:path";
import { createHandler } from "./server.ts";

export const DEFAULT_PORT = 4178;

export function resolveConfig(env: Record<string, string | undefined>, cwd: string): { port: number; workspaceRoot: string } {
  const port = Number(env.PORT);
  const root = env.AIDLC_WORKSPACE_ROOT?.trim();
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    workspaceRoot: resolve(cwd, root || "."),
  };
}

if (import.meta.main) {
  const { port, workspaceRoot } = resolveConfig(process.env, process.cwd());
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: createHandler({ workspaceRoot }) });
  console.log(`AI-DLC viz (read-only) at http://127.0.0.1:${server.port}/`);
  console.log(`Workspace: ${workspaceRoot}`);
}
