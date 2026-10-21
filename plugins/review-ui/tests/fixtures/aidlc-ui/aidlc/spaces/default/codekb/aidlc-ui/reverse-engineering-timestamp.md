# Reverse Engineering Timestamp

- **Performed**: 2026-10-16T15:15:54Z (UTC)
- **Repo**: `aidlc-ui` (workspace project root; unrecorded project-root repo)
- **Commit hash**: not available (the workspace root is not a git repository)
- **Scan kind**: FULL RESCAN — all nine CodeKB artifacts rebuilt from this run
  only.
- **Depth**: Minimal (poc scope).
- **Method**: Synthesized from the developer code scan handoff
  (`inception/reverse-engineering/developer-scan.md`), with the `aidlc-viz/`
  application source read directly to confirm details. The surrounding `.kiro/`
  and `aidlc/` framework trees were classified by directory-granularity
  inventory only (runtime data source / context, not part of the application
  build).

## Scope of Analysis

```yaml
scope_version: 1
kind: full
intent: 261016-viz-graph-view
fingerprint: unknown
analyzed:
  paths:
    - ./
    - aidlc-viz/
    - aidlc-viz/src/
    - aidlc-viz/src/lib/
    - aidlc-viz/public/
  components:
    - server
    - app
    - aggregation
    - state-parser
    - audit-parser
    - scanner
    - types
    - frontend-state
    - frontend-spa
shallow:
  paths:
    - .kiro/
    - aidlc/spaces/default/
```
