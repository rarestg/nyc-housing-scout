# Reviews

Point-in-time architectural assessments. Each evaluates the system's design, identifies gaps, and recommends next steps.

| Doc | Focus |
|-----|-------|
| [2026-03-12_16-11-15_ARCHITECTURE_REVIEW](2026-03-12_16-11-15_ARCHITECTURE_REVIEW.md) | Full-system audit — collector contract, correctness gaps, prioritized action plan |
| [2026-03-12_16-39-19_STORAGE_ARCHITECTURE_REVIEW](2026-03-12_16-39-19_STORAGE_ARCHITECTURE_REVIEW.md) | Persistence layer — why SQLite, schema direction, migration from flat files |
| [2026-03-12_20-48-15_SCALE_ARCHITECTURE_REVIEW](2026-03-12_20-48-15_SCALE_ARCHITECTURE_REVIEW.md) | Scaling bottlenecks — browser runtime limits, orchestration, worker model |
| [2026-03-16_00-40-29_CLOUDFLARE_DEPLOYMENT_READINESS_REVIEW](2026-03-16_00-40-29_CLOUDFLARE_DEPLOYMENT_READINESS_REVIEW.md) | Cloud deployment readiness — what can move to Cloudflare, what should stay local, and why D1 is the best first target |
| [2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW](2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md) | Collector/runtime simplification — what to keep, what to demote, and how to narrow the browser-control boundary |
| [2026-03-17_17-05-01_OPERATOR_UI_REVIEW_AND_BACKLOG](2026-03-17_17-05-01_OPERATOR_UI_REVIEW_AND_BACKLOG.md) | Deferred operator-surface backlog — run context, jobs/payload inspection, listing provenance clarity, review deduping, and JSON ergonomics |
| [2026-03-17_17-10-01_SQLITE_STORAGE_REFACTOR_REVIEW](2026-03-17_17-10-01_SQLITE_STORAGE_REFACTOR_REVIEW.md) | Deferred storage modularization — extract pure dashboard/effective-value/query helpers, keep raw SQL, and later push dashboard filtering/sorting into SQL |
| [2026-03-17_18-16-44_OPERATOR_UI_BACKLOG_REVALIDATION](2026-03-17_18-16-44_OPERATOR_UI_BACKLOG_REVALIDATION.md) | Current filtered operator-surface backlog — keeps only still-valid UI items, drops stale claims, and reprioritizes later dispatch work |

## Operator UI Backlog Note

For the operator UI backlog, read both of these docs together:

- `2026-03-17_17-05-01_OPERATOR_UI_REVIEW_AND_BACKLOG.md`
- `2026-03-17_18-16-44_OPERATOR_UI_BACKLOG_REVALIDATION.md`

Why two docs exist:

- `...17-05-01_OPERATOR_UI_REVIEW_AND_BACKLOG` is the broader original review and preserves the full starting assessment, concerns, strengths, and raw backlog framing.
- `...18-16-44_OPERATOR_UI_BACKLOG_REVALIDATION` is the later filter and triage pass. It keeps the still-valid items, drops or downgrades stale ones, and is the better source when a PM is preparing a future execution bundle.

Recommended reading order:

1. read the original review for full context
2. read the revalidation doc for the current backlog-worthy subset and dispatch order
