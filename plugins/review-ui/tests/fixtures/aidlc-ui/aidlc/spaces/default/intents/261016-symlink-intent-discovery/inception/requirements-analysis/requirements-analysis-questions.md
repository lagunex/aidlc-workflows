# Requirements Analysis — Questions

The bug is diagnosed (from the code scan): `discoverIntents()` in
`aidlc-viz/src/lib/scanner.ts` filters directory entries with `isDirectory()`
only, so a symlink pointing at a valid intent directory (which reports
`isSymbolicLink() === true` and `isDirectory() === false`) is dropped before the
`aidlc-state.md` validity check. These questions settle the fix boundary.

## Q1. How wide should the fix be?

The same `isDirectory()`-only filter appears in three places in `scanner.ts`: space discovery, intent discovery (the reported bug), and `listArtifacts` (the stage-artifact file tree). A symlinked space or a symlinked artifact subdirectory would be dropped the same way.

- A. Fix only intent discovery (the exact reported bug) — minimal, targeted
- B. Fix intent discovery AND space discovery (so a symlinked team/space is also found)
- C. Fix all three sites consistently — intent discovery, space discovery, and the artifact file tree — one coherent symlink-handling policy
- X. Other (please specify)

[Answer]: C. Fix all three sites consistently — intent discovery, space discovery, and the artifact file tree — one coherent symlink-handling policy

## Q2. What should "valid" mean for a symlinked entry?

A symlink could point at a non-directory, a missing target (broken link), or a directory that isn't actually an intent. The existing `aidlc-state.md` existence check already gates intent validity.

- A. Treat a symlink as a candidate when it resolves to a directory (follow the link, then stat the target); keep the existing `aidlc-state.md` check as the real validity gate. Broken/non-directory symlinks are skipped silently (resilience, NFR4)
- B. Same as A, but also log/skip broken symlinks explicitly
- C. Not sure — recommend the safest behavior for a read-only poc
- X. Other (please specify)

[Answer]: A. Treat a symlink as a candidate when it resolves to a directory (follow the link, then stat the target); keep the existing `aidlc-state.md` check as the real validity gate. Broken/non-directory symlinks are skipped silently (resilience, NFR4)

## Q3. Any concern about path-confinement safety when following symlinks?

The read-only file endpoint confines artifact reads to within the record directory using string-based path checks (`path.resolve`/`path.relative`, not `realpath`). Following symlinks for discovery doesn't change the file endpoint, but it's worth a conscious decision.

- A. Keep the fix scoped to discovery only; do not change the file-endpoint confinement for this bugfix (the symlink is on the record directory itself, resolved server-side, not attacker-controlled). Note realpath hardening as a future item
- B. Also harden the file endpoint to use `realpath` in this bugfix
- C. Not sure — recommend
- X. Other (please specify)

[Answer]: A. Keep the fix scoped to discovery only; do not change the file-endpoint confinement for this bugfix. Note realpath hardening as a future item

## Consolidated Summary Confirmation

- Root cause: `discoverIntents()` in `aidlc-viz/src/lib/scanner.ts` uses an `isDirectory()`-only filter, dropping symlinked valid intent directories before the `aidlc-state.md` validity check.
- Fix scope: all three `isDirectory()`-only sites in `scanner.ts` — intent discovery, space discovery, and the `listArtifacts` artifact tree — get one consistent symlink-handling policy.
- Validity rule: an entry is a candidate if it is a directory OR a symlink that resolves to a directory (follow + stat the target); the existing `aidlc-state.md` existence check stays the real intent-validity gate. Broken or non-directory symlinks are skipped silently (resilience, NFR4).
- Confinement: the fix stays scoped to discovery; the read-only file endpoint's string-based path confinement is unchanged for this bugfix; realpath hardening noted as a future item.
- Testing: a bugfix regression test must reproduce the symptom (a symlinked intent is discovered) and the existing suite must stay green.

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
