// The command as a person runs it: it says what it reads and where to open
// it, listens on 127.0.0.1 only (another interface is refused), answers HEAD
// with no body, accepts the live socket only from its own page's origin,
// pushes {"type":"state"} when a record changes (a linked one too), falls
// back to polling when the platform cannot watch, exits 0 on SIGTERM, writes
// nothing (not in the project, not in HOME), and stops with the exact
// sentence for an old Bun, a bad or taken port, or no workspace.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_FIXTURE_SETUP_TIMEOUT_MS, NATIVE_STARTUP_TIMEOUT_MS, remainingOperationTimeoutMs } from "../../../tests/harness/test-budget.ts";
import { BUN_MESSAGE, noWorkspaceMessage, parseArgs, runtimeProblem } from "../tools/review-ui.ts";
import {
  DEFAULT_PORTS,
  ignoredChange,
  PORT_SETTING_MESSAGE,
  portPlan,
  portTakenMessage,
  REVIEW_UI_VERSION,
  serveOptions,
  startLive,
} from "../tools/review-ui/serve.ts";
import { createHandler } from "../tools/review-ui/server.ts";
import { Workspace } from "../tools/review-ui/workspace.ts";

setDefaultTimeout(NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "tools", "review-ui.ts");
const PLUGIN_JSON = join(HERE, "..", ".aidlc-plugin", "plugin.json");
const RECORD = "261020-sample";
const LINKED = "261021-linked";

const STATE = `# AI-DLC State Tracking

## Stage Progress
### INCEPTION PHASE
- [-] requirements-analysis — EXECUTE

## Current Status
- **Current Stage**: requirements-analysis
- **Status**: Running
`;

const temps: string[] = [];
function tempDir(): string {
  // macOS temp roots may be reached through /var -> /private/var.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-review-ui-")));
  temps.push(dir);
  return dir;
}

function put(base: string, path: string, content: string): void {
  mkdirSync(dirname(join(base, path)), { recursive: true });
  writeFileSync(join(base, path), content);
}

function listing(base: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      found.push(`${path} ${entry.isSymbolicLink() ? "link" : statSync(path).mtimeMs}`);
      if (entry.isDirectory()) walk(path);
    }
  };
  walk(base);
  return found.sort();
}

let project = "";
let outside = "";
let home = "";
let linked = false;

beforeAll(() => {
  project = tempDir();
  outside = tempDir();
  home = tempDir();
  put(project, `aidlc/spaces/default/intents/${RECORD}/aidlc-state.md`, STATE);
  put(outside, "record/aidlc-state.md", STATE);
  try {
    symlinkSync(join(outside, "record"), join(project, `aidlc/spaces/default/intents/${LINKED}`), "junction");
    linked = true;
  } catch {
    linked = false;
  }
});

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function budget(): number {
  return remainingOperationTimeoutMs(NATIVE_STARTUP_TIMEOUT_MS) ?? NATIVE_STARTUP_TIMEOUT_MS;
}

/** Resolves with what the promise gives, or rejects after the backstop; never a fixed sleep. */
function within<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), budget());
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface Started {
  proc: ReturnType<typeof Bun.spawn>;
  port: number;
  lines: string[];
}

function cliEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, USERPROFILE: home, REVIEW_UI_PORT: "0", ...extra };
  return env;
}

async function startCli(args: string[], extra: Record<string, string> = {}): Promise<Started> {
  const proc = Bun.spawn([process.execPath, CLI, ...args], { env: cliEnv(extra), stdout: "pipe", stderr: "pipe", cwd: home });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  const port = await within(
    (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`the command ended before it was ready: ${text}`);
        text += decoder.decode(value, { stream: true });
        const match = /http:\/\/127\.0\.0\.1:(\d+)\/ \(Ctrl\+C stops it\)\n/.exec(text);
        if (match) return Number(match[1]);
      }
    })(),
    "the start line",
  );
  reader.releaseLock();
  return { proc, port, lines: text.trimEnd().split("\n") };
}

async function runCli(args: string[], extra: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, CLI, ...args], { env: cliEnv(extra), stdout: "pipe", stderr: "pipe", cwd: home });
  const code = await within(proc.exited, "the command to exit");
  return { code, stdout: await new Response(proc.stdout as ReadableStream).text(), stderr: await new Response(proc.stderr as ReadableStream).text() };
}

describe("the running command", () => {
  let started: Started;
  const projectBefore: string[] = [];

  beforeAll(async () => {
    projectBefore.push(...listing(project));
    started = await startCli(["serve", "--project-dir", project]);
  });

  afterAll(async () => {
    if (started && started.proc.exitCode === null) {
      started.proc.kill("SIGKILL");
      await started.proc.exited;
    }
  });

  test("it says what it reads and where to open it, on 127.0.0.1", async () => {
    expect(started.lines).toEqual([`Reading ${project}`, `Review UI (read-only) for ${basename(project)}: http://127.0.0.1:${started.port}/ (Ctrl+C stops it)`]);
    const health = await fetch(`http://127.0.0.1:${started.port}/api/health`);
    expect(await health.json()).toEqual({ ok: true, version: REVIEW_UI_VERSION });
  });

  test("another interface of this machine is refused", async () => {
    const address = Object.values(networkInterfaces())
      .flat()
      .find((each) => each && each.family === "IPv4" && !each.internal)?.address;
    if (!address) return;
    const code = await within(
      new Promise<string>((resolve) => {
        const socket = connect({ host: address, port: started.port });
        socket.on("connect", () => {
          socket.destroy();
          resolve("connected");
        });
        socket.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "error"));
      }),
      "the refused connection",
    );
    expect(code).toBe("ECONNREFUSED");
  });

  test("HEAD over TCP answers with headers and no body", async () => {
    const reply = await within(
      new Promise<string>((resolve, reject) => {
        let text = "";
        const socket = connect({ host: "127.0.0.1", port: started.port }, () => {
          socket.write(`HEAD /api/health HTTP/1.1\r\nHost: 127.0.0.1:${started.port}\r\nConnection: close\r\n\r\n`);
        });
        socket.on("data", (chunk) => {
          text += chunk.toString("latin1");
        });
        socket.on("end", () => resolve(text));
        socket.on("error", reject);
      }),
      "the HEAD reply",
    );
    expect(reply).toMatch(/^HTTP\/1\.1 200 /);
    expect(reply.toLowerCase()).toContain("x-content-type-options: nosniff");
    expect(reply.slice(reply.indexOf("\r\n\r\n") + 4)).toBe("");
  });

  test("the live socket opens from the page's origin and refuses another", async () => {
    const opened = await within(socketOutcome(started.port, `http://127.0.0.1:${started.port}`), "the socket to open");
    expect(opened.outcome).toBe("open");
    opened.socket.close();
    const refused = await within(socketOutcome(started.port, "http://evil.example"), "the socket to be refused");
    expect(refused.outcome).toBe("refused");
  });

  test("an edit to a record, and to a linked record, pushes a state message", async () => {
    const { socket, outcome } = await within(socketOutcome(started.port, `http://127.0.0.1:${started.port}`), "the socket to open");
    expect(outcome).toBe("open");
    const messages: string[] = [];
    let wake: (() => void) | null = null;
    socket.addEventListener("message", (event) => {
      messages.push(String(event.data));
      wake?.();
    });
    const nextMessage = (count: number): Promise<void> =>
      new Promise((resolve) => {
        if (messages.length >= count) return resolve();
        wake = () => {
          if (messages.length >= count) resolve();
        };
      });
    appendFileSync(join(project, `aidlc/spaces/default/intents/${RECORD}/aidlc-state.md`), "\n");
    await within(nextMessage(1), "a push after the record changed");
    expect(JSON.parse(messages[0])).toEqual({ type: "state" });
    if (linked) {
      appendFileSync(join(outside, "record/aidlc-state.md"), "\n");
      await within(nextMessage(2), "a push after the linked record changed");
      expect(JSON.parse(messages[1])).toEqual({ type: "state" });
    }
    socket.close();
  });

  test("SIGTERM stops it with exit code 0, and it wrote nothing", async () => {
    // Windows has no signal a process can catch: kill() ends it with
    // TerminateProcess (exit code 1), so only the exit code is POSIX-only.
    started.proc.kill("SIGTERM");
    const code = await within(started.proc.exited, "the command to exit");
    if (process.platform !== "win32") expect(code).toBe(0);
    // Bun keeps a transpile cache of the modules it loads under ~/.bun, for any
    // script it runs; nothing else may appear in HOME.
    expect(listing(home).filter((line) => !line.startsWith(join(home, ".bun")))).toEqual([]);
    // The push test appended to this state file; listing() joins with "\" on Windows.
    const edited = (line: string): boolean => line.replaceAll("\\", "/").includes(`${RECORD}/aidlc-state.md `);
    expect(listing(project).filter((line) => !edited(line))).toEqual(projectBefore.filter((line) => !edited(line)));
  });
});

// Bun's WebSocket takes request headers, so a test can send another site's Origin.
function socketOutcome(port: number, origin: string): Promise<{ socket: WebSocket; outcome: "open" | "refused" }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: origin } } as unknown as string[]);
    socket.addEventListener("open", () => resolve({ socket, outcome: "open" }));
    socket.addEventListener("error", () => resolve({ socket, outcome: "refused" }));
  });
}

describe("refusals, in the exact words", () => {
  test("a bad port setting, and a pinned port that is taken", async () => {
    for (const setting of ["abc", "-1", "70000", "1.5"]) {
      const result = await runCli(["serve", "--project-dir", project], { REVIEW_UI_PORT: setting });
      expect(result.code, setting).toBe(2);
      expect(result.stderr.trim()).toBe(PORT_SETTING_MESSAGE);
    }
    const holder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    try {
      const result = await runCli(["serve", "--project-dir", project], { REVIEW_UI_PORT: String(holder.port) });
      expect(result.code).toBe(2);
      expect(result.stderr.trim()).toBe(portTakenMessage(holder.port ?? 0));
      expect(result.stderr.trim()).toBe(`Port ${holder.port} is already in use; set REVIEW_UI_PORT=0 to pick a free one`);
    } finally {
      await holder.stop(true);
    }
  });

  test("no workspace above the folder", async () => {
    const empty = tempDir();
    const result = await runCli(["serve", "--project-dir", empty]);
    expect(result.code).toBe(2);
    expect(result.stderr.trim()).toBe(noWorkspaceMessage(empty));
    expect(result.stderr.trim()).toBe(`No AI-DLC workspace found above ${empty}; pass --project-dir <path>`);
  });

  test("--help names the command, the option and the port setting", async () => {
    const result = await runCli(["--help"]);
    expect(result.code).toBe(0);
    for (const word of ["serve", "--project-dir", "REVIEW_UI_PORT"]) expect(result.stdout).toContain(word);
    expect((await runCli([])).code).toBe(2);
    expect((await runCli(["serve", "--bogus"])).code).toBe(2);
  });

  test("an old Bun, or one without Bun.markdown, gets the one sentence", () => {
    const markdown = { render: () => "", react: () => null };
    expect(BUN_MESSAGE).toBe("Review UI needs Bun 1.3.8 or newer: https://bun.sh");
    expect(runtimeProblem("1.3.7", markdown)).toBe(BUN_MESSAGE);
    expect(runtimeProblem("1.2.20", markdown)).toBe(BUN_MESSAGE);
    expect(runtimeProblem("0.9.9", markdown)).toBe(BUN_MESSAGE);
    expect(runtimeProblem(undefined, markdown)).toBe(BUN_MESSAGE);
    expect(runtimeProblem("1.4.2", {})).toBe(BUN_MESSAGE);
    expect(runtimeProblem("1.4.2", { render: () => "" })).toBe(BUN_MESSAGE);
    expect(runtimeProblem("1.4.2", undefined)).toBe(BUN_MESSAGE);
    expect(runtimeProblem(Bun.version, Bun.markdown)).toBeNull();
    expect(runtimeProblem("1.3.8", markdown)).toBeNull();
    expect(runtimeProblem("1.4.0", markdown)).toBeNull();
    expect(runtimeProblem("2.0.0-canary.1", markdown)).toBeNull();
  });
});

describe("the pieces", () => {
  test("the server binds 127.0.0.1, whatever the port", () => {
    const handler = createHandler({ projectDir: project, version: REVIEW_UI_VERSION });
    for (const port of [0, 4790, 5000]) expect(serveOptions(handler, port)).toMatchObject({ hostname: "127.0.0.1", port, development: false });
  });

  test("REVIEW_UI_PORT: unset tries 4790 to 4799 then any port; 0 is any port; a number pins it", () => {
    expect(DEFAULT_PORTS).toEqual([4790, 4791, 4792, 4793, 4794, 4795, 4796, 4797, 4798, 4799]);
    expect(portPlan(undefined)).toEqual({ ports: [...DEFAULT_PORTS, 0], pinned: false });
    expect(portPlan(" ")).toEqual({ ports: [...DEFAULT_PORTS, 0], pinned: false });
    expect(portPlan("0")).toEqual({ ports: [0], pinned: false });
    expect(portPlan("5000")).toEqual({ ports: [5000], pinned: true });
    for (const bad of ["abc", "-1", "65536", "1.5", "0x10"]) expect(portPlan(bad)).toEqual({ error: PORT_SETTING_MESSAGE });
  });

  test("the command line takes serve and --project-dir", () => {
    expect(parseArgs(["serve"])).toEqual({ projectDir: null });
    expect(parseArgs(["serve", "--project-dir", "x"])).toEqual({ projectDir: "x" });
    expect(parseArgs(["serve", "--project-dir=y"])).toEqual({ projectDir: "y" });
    expect(parseArgs(["serve", "-h"])).toEqual({ help: true });
    expect("error" in parseArgs(["serve", "--project-dir"])).toBe(true);
    expect("error" in parseArgs(["start"])).toBe(true);
  });

  test("changes inside dot-folders are ignored", () => {
    expect(ignoredChange(`default/intents/${RECORD}/.aidlc-engine/x.json`)).toBe(true);
    expect(ignoredChange(".aidlc-sessions/a")).toBe(true);
    expect(ignoredChange(`default/intents/${RECORD}/aidlc-state.md`)).toBe(false);
    expect(ignoredChange(null)).toBe(false);
  });

  test("when watching fails (out of inotify watches), polling takes over and still sees a change", async () => {
    const polled = tempDir();
    put(polled, `aidlc/spaces/default/intents/${RECORD}/aidlc-state.md`, STATE);
    let changed: () => void = () => {};
    const seen = new Promise<void>((resolve) => {
      changed = resolve;
    });
    const live = startLive({
      workspace: new Workspace(polled),
      onChange: () => changed(),
      debounceMs: 10,
      minIntervalMs: 10,
      pollMs: 50,
      watch: () => {
        throw Object.assign(new Error("no space left for watches"), { code: "ENOSPC" });
      },
    });
    try {
      expect(live.mode()).toBe("poll");
      appendFileSync(join(polled, `aidlc/spaces/default/intents/${RECORD}/aidlc-state.md`), "\n- **Last Updated**: now\n");
      await within(seen, "the poll to see the change");
    } finally {
      live.stop();
    }
  });

  test("the version the server reports is the plugin's", () => {
    expect(JSON.parse(readFileSync(PLUGIN_JSON, "utf8")).version).toBe(REVIEW_UI_VERSION);
  });
});
