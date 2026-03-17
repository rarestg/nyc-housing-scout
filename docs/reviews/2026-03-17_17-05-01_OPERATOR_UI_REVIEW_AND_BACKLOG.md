# Operator UI Review And Backlog

Point-in-time review of the current operator surfaces after the dashboard redesign, UI simplification, and evidence/review milestone closeout.

This doc is intentionally stored as a review, not an active execution bundle. It should be treated as deferred UI backlog input for a later operator-surface pass once the higher-priority runtime/backend work is done.

Read this together with:

- `docs/reviews/2026-03-17_18-16-44_OPERATOR_UI_BACKLOG_REVALIDATION.md`

Why:

- this document preserves the broader original assessment
- the revalidation document filters that assessment against the newer codebase and is the better source for current backlog dispatching

## Scope

Reviewed surfaces:

- `/debug/runs/:runId`
- `/inspector#run=...&tab=jobs`
- `/debug`
- `/posts`
- `/listings`
- `/review`

Primary operator tasks:

- compare an observed post to its processed Gemini payload
- move run -> observation -> job -> listing without losing context
- understand canonical vs historical listing rows
- triage review backlog efficiently
- inspect source text, normalized payload, and raw JSON together

## Findings

### High

1. Jobs and payload inspection are still not first-class, and the dashboard handoff to the legacy jobs inspector is unreliable.
   - Symptoms:
     - run-scoped inspector tabs rendered empty even when the live API returned jobs, observations, and listings for the same run
   - Why it matters:
     - breaks the core operator loop for provenance and payload review
   - Backlog direction:
     - make jobs/payload inspection first-class in the dashboard
     - fix run-scoped inspector deep links so non-empty runs never render as empty

2. Run context drops as soon as the operator leaves `/debug`.
   - Symptoms:
     - `Posts from source` and `Listings from source` open source-wide views
     - `/posts` and `/listings` do not expose a run filter
     - deep links fall back to `Outside current page` behavior for older records
   - Why it matters:
     - run-centric forensics turn into source-wide archaeology
   - Backlog direction:
     - add persistent run chip or breadcrumb
     - add true run-scoped links
     - add optional run filters on `/posts` and `/listings`

3. Listings mix Gemini-derived rows and historical/non-canonical rows without making that distinction obvious at scan time.
   - Symptoms:
     - the table presents rows that look equally canonical
     - the distinction only becomes clearer later in detail
   - Why it matters:
     - operators can misread current truth vs historical evidence
   - Backlog direction:
     - surface provenance/canonical status directly in the table
     - or split historical/non-canonical rows into a clearly labeled secondary view

### Medium-High

4. `/debug/runs/:runId` behaves more like a jump hub than a real forensics workspace.
   - Symptoms:
     - missing inline step progression, last fresh step, stop reason, and nearby evidence previews
     - `idle` has to be inferred from `FRESH 0`
   - Why it matters:
     - operators need extra route hops before they see evidence
   - Backlog direction:
     - add compact progression summary
     - add first-row previews for steps, artifacts, and posts
     - add explicit outcome badges like `Fresh`, `Idle`, `Failed`

5. `/review` repeats the same listing multiple times for different reasons.
   - Symptoms:
     - one listing can appear in `Ambiguous`, `Low confidence`, and `Incomplete`
   - Why it matters:
     - the queue looks longer and noisier than the actual work queue
   - Backlog direction:
     - make one row per item
     - group reasons into tags/counts
     - expand full reasons in detail

### Medium

6. JSON inspection is buried and cramped.
   - Symptoms:
     - raw JSON sits low in a narrow detail pane and is hard to compare with source evidence
   - Why it matters:
     - JSON inspection is real operator work, not an edge case
   - Backlog direction:
     - add a wider or pop-out payload/code view
     - support side-by-side source vs normalized inspection

7. `/posts` and the legacy inspector are still visually repetitive and slower to scan than they should be.
   - Symptoms:
     - repeated source/group text in `/posts`
     - run identity not surfaced enough
     - tall run cards in `/inspector`
     - stale detail selection risk when filtering runs
   - Why it matters:
     - repeated chrome slows desktop operator scanning
   - Backlog direction:
     - surface run/date more clearly in `/posts`
     - de-emphasize repeated source text
     - add a compact run-list mode and safer filtered selection behavior in the inspector

## Strengths To Preserve

- `/listings` is genuinely dense and scannable on desktop
- the listing column is the right visual anchor
- the listing review/status cell is useful
- deep-linkable cross-links are the right direction
- raw artifact file view is simple but effective
- the legacy inspector still has the right entity model:
  - runs
  - observations
  - jobs
  - listings
  - steps
  - artifacts

## Open Questions

- Is the inspector deep-link problem only brittle, or fully broken in real use?
  - this review treats it as real because the live APIs returned data for the same run
- Are historical/non-canonical listing rows intentionally meant to stay in the primary listings workspace?
  - if yes, the UI needs to say that much more clearly
- Should future run-centric forensics stay split between dashboard and inspector, or should more of that flow become dashboard-native?

## Deferred Backlog Triage

### Must fix before wider operator use

- fix run-scoped inspector/deep-link behavior for observations/jobs/listings
- preserve run context across route hops with real run-scoped links and filters
- make jobs/processed payload inspection first-class instead of burying it behind dashboard-to-inspector handoffs

### Should fix soon

- make listing provenance/canonical status obvious in the main table
- turn `/debug` into a more complete run-forensics workspace
- collapse duplicate review rows into one item with grouped reasons
- bias `/listings` toward operator filters over shopper-style filters where they conflict

### Nice to have later

- wider or pop-out JSON inspector
- explicit `Fresh` / `Idle` / `Failed` run outcome badges
- compact run-list mode and better repeated-observation grouping

## Recommended Use

Do not start a new UI execution bundle from this review immediately.

Use this doc as deferred backlog input once:

- the multi-source collector runtime / ingest hardening milestone is planned or underway
- there is room for a new operator-surface pass

When that later UI pass starts:

- treat the `Must fix` section as the initial planning input
- preserve the strengths listed above
- decide explicitly whether jobs/payload inspection remains split across dashboard + inspector or becomes a first-class dashboard surface
