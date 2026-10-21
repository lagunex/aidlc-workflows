# Requirements — Symlinked Intent Discovery Fix (bugfix)

## Intent Analysis

The AI-DLC visualizer (`aidlc-viz`) lists only one intent on its overview even
though the workspace contains two valid intents, because one intent's record
directory is a **symbolic link**. The goal is to make intent discovery include
valid intents reached through symlinks, so the overview, intent graph, artifact
browser, and decisions views are consistent with what is actually on disk. This
is a targeted bugfix at Minimal depth.

The root cause (from the reverse-engineering CodeKB, `code-structure.md` and
`code-quality-assessment.md`): `discoverIntents()` in
`aidlc-viz/src/lib/scanner.ts` filters directory entries with
`Dirent.isDirectory()` only. A symbolic link to a directory reports
`isSymbolicLink() === true` and `isDirectory() === false`, so a symlinked valid
intent is dropped before the `aidlc-state.md` validity check ever runs. The same
`isDirectory()`-only pattern appears in three places in `scanner.ts`: space
discovery, intent discovery (the reported bug), and the `listArtifacts`
recursive walk.

## Functional Requirements

### FR1 — Discover symlinked intents
- **FR1.1** Intent discovery shall include an entry under `aidlc/spaces/<space>/intents/` when the entry is a directory OR a symbolic link that resolves to a directory. Discovery follows the symlink and stats the target to make this determination.
- **FR1.2** The existing `aidlc-state.md` existence check shall remain the authoritative intent-validity gate: a discovered (directory or symlinked-directory) entry is a valid intent only when it contains `aidlc-state.md`. Following symlinks does not loosen what counts as a valid intent.
- **FR1.3** A symlinked intent that is valid shall appear in `GET /api/intents` (the overview) exactly as a regular-directory intent does, with the same progress, graph, artifacts, and decisions behavior.

### FR2 — Consistent symlink handling across the scanner
- **FR2.1** Space discovery shall apply the same rule: a `aidlc/spaces/` entry is a candidate space when it is a directory or a symlink resolving to a directory, so a symlinked team/space is discovered.
- **FR2.2** The `listArtifacts` recursive walk shall apply the same rule for traversed subdirectories (and continue to include regular files), so a symlinked artifact subdirectory within a record is traversed.
- **FR2.3** The three sites shall share one consistent symlink-resolution helper or policy rather than three divergent ad-hoc checks.

### FR3 — Safe handling of bad symlinks (resilience)
- **FR3.1** A symbolic link whose target is missing (broken link) or is not a directory shall be skipped without throwing, and discovery of all other (sibling) intents and spaces shall still succeed. **Verifiable check**: given a directory containing one valid intent plus one broken symlink and one symlink to a file, discovery returns the valid intent and does not throw.

## Non-Functional Requirements

- **NFR1 — Read-only preserved**: The fix shall not introduce any write/modify/delete of workspace files; discovery remains strictly read-only.
- **NFR2 — No behavior change for existing cases**: Regular-directory intents, the `active-intent`/`active-space` cursor-file skipping, and all current discovery behavior shall remain unchanged (no regressions). **Verifiable check**: the existing test suite (`npm test`) stays green, and the current discovery tests for regular-directory intents and cursor-file skipping pass unchanged.
- **NFR3 — Resilience to filesystem errors**: Discovery shall tolerate per-entry `stat`/`readlink` errors (broken links, permission errors) by skipping the offending entry and continuing, consistent with the existing graceful-empty posture.

## Constraints

- **C1** Scope is a bugfix at Minimal depth; keep the change tightly focused on the scanner's directory-entry filtering. The read-only file endpoint's path confinement is NOT changed by this bugfix (see Out of Scope / Open Questions).
- **C2** TypeScript / Node, within the existing `aidlc-viz/src/lib/scanner.ts` structure; follow the project's existing read-only I/O-boundary pattern.
- **C3** Platform note: `fs.symlink` creation behavior/privileges can differ across platforms; the regression test fixture must account for this.

## Assumptions

- **A1** The symlinked intent's target directory contains a valid `aidlc-state.md` (confirmed live during reverse engineering for `aidlc/spaces/default/intents/261016-csv-export`). [assumption]
- **A2** Symlinks encountered in discovery point to locations the server process can `stat` and read. [assumption]

## Out of Scope

- Changing the read-only file-endpoint path confinement to use `fs.realpath` (string-based confinement is retained for this bugfix) [Q3].
- Any UI/behavior change beyond making symlinked intents/spaces/artifacts discoverable.
- The stale README reference to a non-existent `src/lib/stage-graph.ts` (documentation debt noted during reverse engineering; out of this bugfix's scope).

## Open Questions

- **OQ1** `realpath`-based hardening of the file-endpoint confinement is deferred as a future item; if symlink following is ever extended to the file-read path, re-confirm the traversal guard holds for symlinked targets that resolve outside a record directory.
