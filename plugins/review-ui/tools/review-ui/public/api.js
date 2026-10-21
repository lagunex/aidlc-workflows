// Reads from the plugin's own /api routes on this origin, and the live socket
// that says when to read again. The server's error bodies are fixed plain
// sentences, so they are shown as they come.

import { store } from "./store.js";

const STOPPED = "Review UI stopped. Start it again with bun <harness-dir>/tools/review-ui.ts serve; this page reconnects.";

const FALLBACK_ERROR = "Something went wrong reading the workspace.";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function url(path, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/** GET a JSON route; throws ApiError with the server's sentence and status. */
export async function get(path, params) {
  if (!path.startsWith("/api/")) throw new ApiError(FALLBACK_ERROR, 0);
  let response;
  try {
    response = await fetch(url(path, params), { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new ApiError(STOPPED, 0);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new ApiError(typeof body?.error === "string" ? body.error : FALLBACK_ERROR, response.status);
  }
  if (body === null) throw new ApiError(FALLBACK_ERROR, response.status);
  return body;
}

// Waits between reconnect attempts: 1 s doubling to a 30 s ceiling.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * Opens ws://<this host>/ws and calls `onState` for every {type:"state"}
 * push, and once more after a reconnect, since pushes sent while the socket
 * was down are lost. The socket only listens: the page never sends on it.
 */
export function connectSocket(onState) {
  let attempt = 0;
  let missedPushes = false;
  let timer = null;
  let leaving = false;
  window.addEventListener("pagehide", () => {
    leaving = true;
  });

  const schedule = () => {
    if (timer !== null || leaving) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    timer = window.setTimeout(() => {
      timer = null;
      open();
    }, delay);
  };

  const open = () => {
    let socket;
    try {
      socket = new WebSocket(`ws://${location.host}/ws`);
    } catch {
      schedule();
      return;
    }
    socket.addEventListener("open", () => {
      const catchUp = missedPushes;
      missedPushes = false;
      attempt = 0;
      store.set({ connected: true });
      store.emit("paused", null);
      if (catchUp) onState();
    });
    socket.addEventListener("message", (event) => {
      let message = null;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message?.type === "state") onState();
    });
    socket.addEventListener(
      "close",
      () => {
        store.set({ connected: false });
        if (leaving) return;
        missedPushes = true;
        store.emit("paused", STOPPED);
        schedule();
      },
      { once: true },
    );
  };

  open();
}
