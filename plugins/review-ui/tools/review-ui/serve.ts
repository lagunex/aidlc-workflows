// Runs the server: listens on 127.0.0.1 only, picks the port, and keeps open
// pages current as the workspace changes. The hostname is fixed; no setting
// widens it (builder-security: private means loopback).
//
// Live updates: one recursive watch on aidlc/spaces/, plus one on the real
// folder of each linked space or record, which a recursive watch does not
// enter. Changes are coalesced (150 ms after the first, then at most one push
// a second). Where watching is not possible, or fails later (out of inotify
// watches, ENOSPC), a 2 s poll of the state files, registries and audit shards
// takes over.
import { createHandler, internalError, type ReviewUiHandler } from "./server.ts";
import { watchTree, Workspace } from "./workspace.ts";

/** The plugin's version, as in .aidlc-plugin/plugin.json; the tests check they agree. */
export const REVIEW_UI_VERSION = "0.1.0";
export const HOSTNAME = "127.0.0.1";
export const DEFAULT_PORTS: readonly number[] = [4790, 4791, 4792, 4793, 4794, 4795, 4796, 4797, 4798, 4799];
export const PORT_SETTING_MESSAGE = "REVIEW_UI_PORT must be a port number from 0 to 65535; use REVIEW_UI_PORT=0 for any free port";

export function portTakenMessage(port: number): string {
  return `Port ${port} is already in use; set REVIEW_UI_PORT=0 to pick a free one`;
}

export function portRefusedMessage(port: number): string {
  return `Port ${port} cannot be opened here; set REVIEW_UI_PORT=0 to pick a free one`;
}

export type PortPlan = { ports: number[]; pinned: boolean } | { error: string };

/** REVIEW_UI_PORT: unset tries 4790 to 4799 then any free port; 0 is any free port; a number pins it. */
export function portPlan(setting: string | undefined): PortPlan {
  const text = setting?.trim() ?? "";
  if (text === "") return { ports: [...DEFAULT_PORTS, 0], pinned: false };
  if (!/^\d{1,5}$/.test(text) || Number(text) > 65_535) return { error: PORT_SETTING_MESSAGE };
  const port = Number(text);
  return { ports: [port], pinned: port !== 0 };
}

/**
 * The Bun.serve options; the hostname is always 127.0.0.1. Bun's development
 * error page would show a stack trace, so a failure gets the fixed sentence.
 */
export function serveOptions(handler: ReviewUiHandler, port: number) {
  return {
    hostname: HOSTNAME,
    port,
    development: false,
    fetch: (request: Request, server: Bun.Server<undefined>) => handler.fetch(request, server),
    error: () => internalError(port),
    websocket: handler.websocket,
  };
}

function addressInUse(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "EADDRINUSE" || /in use/i.test(String((error as Error)?.message ?? ""));
}

/** Binds the first port of the plan that opens; a pinned port that does not is the person's to change. */
export function listen(handler: ReviewUiHandler, plan: { ports: number[]; pinned: boolean }): Bun.Server<undefined> | { error: string } {
  for (const [index, port] of plan.ports.entries()) {
    try {
      return Bun.serve(serveOptions(handler, port));
    } catch (error) {
      if (plan.pinned) return { error: addressInUse(error) ? portTakenMessage(port) : portRefusedMessage(port) };
      if (index === plan.ports.length - 1) throw error;
    }
  }
  return { error: PORT_SETTING_MESSAGE };
}

export interface LiveOptions {
  workspace: Workspace;
  onChange: () => void;
  debounceMs?: number;
  minIntervalMs?: number;
  pollMs?: number;
  /** The watch primitive; a test passes one that fails, to see the poll take over. */
  watch?: typeof watchTree;
}

export interface Live {
  stop(): void;
  mode(): "watch" | "poll";
}

/** Engine-private folders and other dot-folders change constantly and are never shown. */
export function ignoredChange(relPath: string | null): boolean {
  return relPath?.split("/").some((segment) => segment.startsWith(".")) ?? false;
}

export function startLive(options: LiveOptions): Live {
  const { workspace, onChange } = options;
  const debounceMs = options.debounceMs ?? 150;
  const minIntervalMs = options.minIntervalMs ?? 1000;
  const pollMs = options.pollMs ?? 2000;
  const watchPrimitive = options.watch ?? watchTree;
  const watchers = new Map<string, () => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  let lastPush = Number.NEGATIVE_INFINITY;
  let current: "watch" | "poll" = "watch";
  let stopped = false;

  const fire = (): void => {
    timer = null;
    if (stopped) return;
    lastPush = Date.now();
    if (current === "watch") reconcile();
    onChange();
  };
  const schedule = (): void => {
    if (timer || stopped) return;
    timer = setTimeout(fire, Math.max(debounceMs, lastPush + minIntervalMs - Date.now()));
  };
  const closeWatchers = (): void => {
    for (const close of watchers.values()) close();
    watchers.clear();
  };
  const poll = (): void => {
    if (current === "poll" || stopped) return;
    current = "poll";
    closeWatchers();
    let signature = workspace.pollSignature();
    poller = setInterval(() => {
      const next = workspace.pollSignature();
      if (next !== signature) {
        signature = next;
        schedule();
      }
    }, pollMs);
  };
  // Linked records and spaces come and go, so the extra watches follow discovery.
  function reconcile(): void {
    const targets = new Set(workspace.watchTargets());
    for (const [dir, close] of watchers) {
      if (!targets.has(dir)) {
        close();
        watchers.delete(dir);
      }
    }
    for (const dir of targets) {
      if (watchers.has(dir)) continue;
      try {
        watchers.set(
          dir,
          watchPrimitive(
            dir,
            (relPath) => {
              if (!ignoredChange(relPath)) schedule();
            },
            () => poll(),
          ),
        );
      } catch (error) {
        // A linked folder that vanished since discovery is retried on the next
        // change; any other failure means changes could go unseen, so poll.
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        poll();
        return;
      }
    }
  }

  reconcile();
  if (current === "watch" && watchers.size === 0) poll();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (poller) clearInterval(poller);
      closeWatchers();
    },
    mode: () => current,
  };
}

export interface Running {
  server: Bun.Server<undefined>;
  port: number;
  live: Live;
  stop(): void;
}

/** Starts the server for a project: the port from REVIEW_UI_PORT, then the live watcher. */
export function start(projectDir: string, env: Record<string, string | undefined>): Running | { error: string } {
  const plan = portPlan(env.REVIEW_UI_PORT);
  if ("error" in plan) return plan;
  const handler = createHandler({ projectDir, version: REVIEW_UI_VERSION });
  const server = listen(handler, plan);
  if ("error" in server) return server;
  const live = startLive({ workspace: new Workspace(projectDir), onChange: () => handler.publish() });
  return {
    server,
    port: server.port ?? 0,
    live,
    stop() {
      live.stop();
      void server.stop(true);
    },
  };
}
