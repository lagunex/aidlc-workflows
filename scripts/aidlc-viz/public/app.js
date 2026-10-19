// Browser view for scripts/aidlc-viz: overview -> intent (stage graph or
// decisions) -> a stage's artifacts. Everything comes from the read-only
// JSON API; reloading the page re-reads the workspace.

const viewEl = document.getElementById("view");
const crumbsEl = document.getElementById("crumbs");

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "class") node.className = value;
    else if (key === "onclick") node.addEventListener("click", value);
    else node.setAttribute(key, value);
  }
  for (const child of children || []) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function showError(message) {
  clear(viewEl);
  viewEl.appendChild(el("div", { class: "error-banner", "data-testid": "error" }, [message]));
}

async function api(path) {
  const response = await fetch(path);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function intentPath(space, record, view) {
  return `/api/intents/${encodeURIComponent(space)}/${encodeURIComponent(record)}/${view}`;
}

function setCrumbs(parts) {
  clear(crumbsEl);
  parts.forEach((part, i) => {
    if (i > 0) crumbsEl.appendChild(document.createTextNode(" › "));
    crumbsEl.appendChild(part.onClick ? el("a", { onclick: part.onClick }, [part.label]) : document.createTextNode(part.label));
  });
}

// ---- Overview -------------------------------------------------------------

function intentCard(intent) {
  const pct = Math.round((intent.progress.fraction || 0) * 100);
  const bar = el("div", { class: "bar" }, []);
  // Set through the CSSOM: the page's CSP refuses inline style attributes.
  bar.style.width = `${pct}%`;
  return el(
    "div",
    { class: "intent-card", "data-testid": "intent-card", onclick: () => renderIntent(intent.space, intent.record, "graph") },
    [
      el("h3", { title: intent.title || intent.record }, [intent.record]),
      el("div", { class: "intent-meta" }, [
        `space: ${intent.space} · scope: ${intent.scope} · phase: ${intent.phase} · stage: ${intent.currentStage} · ${intent.status}`,
      ]),
      el("div", { class: "progress" }, [bar]),
      el("div", { class: "progress-label" }, [`${intent.progress.done} / ${intent.progress.total} stages done (${pct}%)`]),
    ],
  );
}

// Finished work: the state file says Completed or Archived, or every stage
// in the plan is done even if the status line lags behind.
function isFinished(intent) {
  const status = String(intent.status || "").toLowerCase();
  if (status.includes("complete") || status.includes("archiv")) return true;
  return intent.progress.total > 0 && intent.progress.fraction >= 1;
}

async function renderOverview() {
  setCrumbs([{ label: "Overview" }]);
  clear(viewEl);
  viewEl.appendChild(el("p", { class: "loading" }, ["Loading intents…"]));
  let intents;
  try {
    intents = (await api("/api/intents")).intents || [];
  } catch (err) {
    showError(err.message);
    return;
  }
  clear(viewEl);
  if (intents.length === 0) {
    viewEl.appendChild(el("p", { class: "empty" }, ["No intents found in the workspace."]));
    return;
  }
  const active = intents.filter((intent) => !isFinished(intent));
  const finished = intents.filter(isFinished);

  const activeSection = el("div", { class: "intent-group", "data-testid": "active-intents" }, [
    el("h2", { class: "group-title" }, [`In progress (${active.length})`]),
  ]);
  if (active.length === 0) activeSection.appendChild(el("p", { class: "empty" }, ["No active intents — all work is complete."]));
  for (const intent of active) activeSection.appendChild(intentCard(intent));
  viewEl.appendChild(activeSection);

  if (finished.length > 0) {
    const body = el("div", { class: "intent-group-body", "data-testid": "completed-intents", hidden: "" }, finished.map(intentCard));
    const toggle = el(
      "button",
      {
        class: "group-toggle",
        type: "button",
        "data-testid": "toggle-completed",
        onclick: () => {
          body.hidden = !body.hidden;
          toggle.textContent = `${body.hidden ? "▸" : "▾"} Completed (${finished.length})`;
        },
      },
      [`▸ Completed (${finished.length})`],
    );
    viewEl.appendChild(el("div", { class: "intent-group completed-group" }, [toggle, body]));
  }
}

// ---- Intent: stage graph and decisions --------------------------------------

function renderIntent(space, record, tab) {
  setCrumbs([{ label: "Overview", onClick: renderOverview }, { label: `${space} / ${record}` }]);
  clear(viewEl);
  const tabButton = (name, label) =>
    el(
      "div",
      { class: `tab${tab === name ? " active" : ""}`, "data-testid": `tab-${name}`, onclick: () => renderIntent(space, record, name) },
      [label],
    );
  viewEl.appendChild(el("div", { class: "tabs" }, [tabButton("graph", "Stage graph"), tabButton("decisions", "Decisions")]));
  const panel = el("div", { "data-testid": "tab-panel" }, []);
  viewEl.appendChild(panel);
  if (tab === "decisions") renderDecisions(space, record, panel);
  else renderGraph(space, record, panel);
}

function stageCard(space, record, stage) {
  const stateClass = stage.inFlow ? `stage--${stage.state}` : "stage--not-in-flow";
  return el(
    "div",
    {
      class: `stage ${stateClass}`,
      "data-testid": "stage",
      "data-state": stage.state,
      "data-in-flow": String(stage.inFlow),
      onclick: () => renderArtifacts(space, record, stage),
    },
    [
      el("div", { class: "nm" }, [stage.name || stage.slug]),
      el("div", { class: "st" }, [stage.label]),
      el("div", { class: "scope-label" }, [stage.scope]),
    ],
  );
}

async function renderGraph(space, record, panel) {
  panel.appendChild(el("p", { class: "loading" }, ["Loading stage graph…"]));
  let phases;
  try {
    phases = (await api(intentPath(space, record, "graph"))).phases || [];
  } catch (err) {
    showError(err.message);
    return;
  }
  clear(panel);
  if (phases.length === 0) {
    panel.appendChild(el("p", { class: "empty" }, ["No stage graph available."]));
    return;
  }
  const flow = el("div", { class: "phase-flow", "data-testid": "phase-flow" }, []);
  phases.forEach((phase, i) => {
    const hasNext = i < phases.length - 1;
    const title = el("h2", { class: "phase-col-title" }, [
      el("span", { class: "phase-name" }, [phase.phase]),
      hasNext ? el("span", { class: "phase-title-arrow", "aria-hidden": "true" }, ["→"]) : null,
    ]);
    const stack = el("div", { class: "stage-stack" }, phase.stages.map((stage) => stageCard(space, record, stage)));
    flow.appendChild(el("div", { class: `phase-col${hasNext ? " has-next" : ""}`, "data-testid": "phase-col" }, [title, stack]));
  });
  panel.appendChild(flow);
}

async function renderDecisions(space, record, panel) {
  panel.appendChild(el("p", { class: "loading" }, ["Loading decisions…"]));
  let decisions;
  try {
    decisions = (await api(intentPath(space, record, "decisions"))).decisions || [];
  } catch (err) {
    showError(err.message);
    return;
  }
  clear(panel);
  if (decisions.length === 0) {
    panel.appendChild(el("p", { class: "empty" }, ["No decisions recorded for this intent."]));
    return;
  }
  for (const decision of decisions) {
    panel.appendChild(
      el("div", { class: "decision", "data-testid": "decision" }, [
        el("div", { class: "d-head" }, [
          el("span", { class: `d-event ${decision.event}` }, [decision.event]),
          el("span", {}, [`stage: ${decision.stage}`]),
          el("span", {}, [decision.timestamp]),
        ]),
        decision.question ? el("div", { class: "d-question", "data-testid": "decision-question" }, [`Q: ${decision.question}`]) : null,
        el("div", { class: "d-body" }, [decision.summary]),
      ]),
    );
  }
}

// ---- Stage artifacts ----------------------------------------------------------

// A stage's artifacts live under a directory named after its slug
// (`<phase>/<stage>/` or `<phase>/<unit>/<stage>/`). A stage with no such
// directory shows the whole record so nothing is hidden.
function stageArtifacts(all, slug) {
  const matches = all.filter((entry) => entry.relPath.split("/").includes(slug));
  return matches.length > 0 ? matches : all;
}

async function renderArtifacts(space, record, stage) {
  setCrumbs([
    { label: "Overview", onClick: renderOverview },
    { label: `${space} / ${record}`, onClick: () => renderIntent(space, record, "graph") },
    { label: `${stage.name || stage.slug} artifacts` },
  ]);
  clear(viewEl);
  viewEl.appendChild(el("p", { class: "loading" }, ["Loading artifacts…"]));
  let all;
  try {
    all = (await api(intentPath(space, record, "artifacts"))).artifacts || [];
  } catch (err) {
    showError(err.message);
    return;
  }
  clear(viewEl);
  const list = stageArtifacts(all, stage.slug);
  const tree = el("div", { class: "art-tree", "data-testid": "art-tree" }, []);
  const viewer = el("div", { class: "art-viewer", "data-testid": "art-viewer" }, [
    el("p", { class: "empty" }, ["Select a file to view its contents (read-only)."]),
  ]);
  if (list.length === 0) tree.appendChild(el("p", { class: "empty" }, ["No artifacts found for this stage."]));
  for (const entry of list) {
    if (entry.type === "dir") {
      tree.appendChild(el("div", { class: "art-item dir" }, [`📁 ${entry.relPath}`]));
    } else {
      tree.appendChild(
        el(
          "div",
          { class: "art-item file", "data-testid": "art-file", onclick: () => openFile(space, record, entry.relPath, viewer) },
          [`📄 ${entry.relPath}`],
        ),
      );
    }
  }
  viewEl.appendChild(el("div", { class: "art-layout" }, [tree, viewer]));
}

// The server renders Markdown with all artifact text escaped and unsafe link
// schemes dropped (scripts/aidlc-viz/markdown.ts); parsing it into an inert
// document and adopting the nodes keeps it out of the live page until then.
function markdownNode(html) {
  const container = el("div", { class: "art-markdown", "data-testid": "file-markdown" }, []);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  container.append(...Array.from(parsed.body.childNodes, (node) => document.adoptNode(node)));
  return container;
}

async function openFile(space, record, relPath, viewer) {
  clear(viewer);
  viewer.appendChild(el("p", { class: "loading" }, [`Loading ${relPath}…`]));
  let data;
  try {
    data = await api(`${intentPath(space, record, "artifacts/file")}?path=${encodeURIComponent(relPath)}`);
  } catch (err) {
    clear(viewer);
    viewer.appendChild(el("div", { class: "error-banner" }, [err.message]));
    return;
  }
  clear(viewer);
  viewer.appendChild(el("h3", {}, [relPath]));
  viewer.appendChild(
    typeof data.html === "string" ? markdownNode(data.html) : el("pre", { "data-testid": "file-content" }, [data.content ?? ""]),
  );
}

renderOverview();
