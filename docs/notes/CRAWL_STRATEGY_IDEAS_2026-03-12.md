# Crawl Strategy Ideas — 2026-03-12

## Scope

This note is a strategy pass only. It is based on:

- current crawl implementation in `src/cli/crawl-dom-latest.js`
- DOM helper behavior in `src/browser/dom-helpers.js`
- current source identity / seen-state behavior in `src/storage/sqlite-storage.js`
- recent docs, especially:
  - `docs/PIPELINE.md`
  - `docs/LIVE_BROWSE_2026-03-12.md`
  - `docs/SCALE_ARCHITECTURE_REVIEW_2026-03-12.md`
- recent observed artifacts and run summaries, especially the latest crawl:
  - `data/collected/facebook/facebook-default/crawl-2026-03-13T00-35-05-584Z.json`
  - `data/listings/facebook/facebook-default/crawl-2026-03-13T00-35-05-584Z.json`

I did not use external web research for this pass. The external patterns below are generic feed-crawler patterns rather than platform-specific reverse engineering.

## Bottom Line

The collector no longer has a metadata problem first. It has a traversal policy problem.

The current system already knows whether a post is `fresh`, `seen`, or `unidentified`. What it does **not** know is:

- where a run should start
- when an incremental run should stop
- when it should switch from "latest sweep" to "older backfill"
- how to skip through a long seen-prefix efficiently

My opinionated recommendation:

1. Stop treating every crawl as one uniform "scroll until target fresh" loop.
2. Add explicit source-level crawl state based on overlap anchors, not `scrollY`.
3. Split "incremental latest sweep" from "backfill to fill quota".
4. Add adaptive skip behavior once the crawler proves it is in a stale zone.

If you do only one thing next, do this:

- make the crawl start deterministic
- add an overlap-anchor stop rule
- only enter deeper backfill mode when the shallow latest sweep under-delivers

## What The Current Crawl Is Doing

### Current mechanics

Today the DOM crawl:

- runs against the currently attached browser page
- assumes that page is already the right group and already in the right sort state
- expands visible `See more`
- extracts every visible card
- records each observation immediately
- scrolls the page by a fixed `1200px`
- repeats until `freshCollected >= target` or scrolling stalls

Important current properties:

- freshness is source-scoped and post-id based, which is good
- the target is already defined in terms of fresh posts, which is also good
- there is still no durable logical cursor or source frontier
- `scrollY` is recorded as debug state, but it is not a useful resume boundary

### Evidence from recent runs

The latest crawl summary was:

- target fresh: `20`
- observed/collected: `33`
- fresh: `12`
- seen: `18`
- unidentified: `3`
- runtime: about `82s`

That is not a small miss. It means the crawler spent most of the run budget re-reading old territory.

The strongest signal is in the latest collected artifact:

- the **first fresh post appears at position 21**
- fresh posts appear at positions `21, 22, 23, 24, 25, 26, 27, 29, 30, 31, 32, 33`
- positions `1-20` were effectively crawl overhead for this run

Repeated top-slice capture runs also came back with `0` fresh posts after the first successful pass. That means the current top-of-feed overlap zone is already large enough to dominate repeated runs.

### What this means operationally

Right now the crawler is doing two jobs badly in one loop:

1. checking whether there are truly new latest posts
2. backfilling older unseen posts when the latest region is already exhausted

Those should not be the same crawl mode.

## Main Diagnosis

The key issue is not "we need better dedupe." The dedupe is already good enough to tell us we are wasting time.

The real issue is missing **frontier semantics**.

The crawler lacks all of these:

- a deterministic run start
- a known overlap marker from the last successful crawl
- a rule for "we have reached previously-covered territory"
- a fast-skip mode for stale stretches
- a distinction between "not enough fresh latest posts exist" and "we have not scrolled far enough yet"

Without those, the crawler can only do one thing:

- fully inspect every visible slice in order

That is exactly why a run can burn 20 observations before the first fresh hit.

## Ideas Worth Trying Immediately

These are the best near-term bets.

### 1. Add a deterministic crawl preflight

Every crawl should begin by forcing a known source state:

- navigate to the canonical source URL
- verify the page is still the expected group
- verify sort mode is `New posts`
- scroll to the top before starting the latest sweep

Why this is worth doing now:

- it removes arbitrary starting position as a source of variance
- it makes run-to-run behavior comparable
- it turns "attached tab happened to be somewhere odd" into an explicit failure instead of hidden crawl waste

My view:

- this is mandatory
- the crawler should not silently proceed if source URL or sort mode cannot be confirmed

### 2. Split crawl mode into `incremental` and `backfill`

This is the single most important design change.

Define two modes:

- `incremental`
  - shallow
  - optimized for newest unseen posts
  - should stop early when it reaches known overlap
- `backfill`
  - deeper
  - optimized for older unseen posts
  - only used when incremental under-fills the target

Why this matters:

- an incremental run should not keep digging a week deep just because the target says `20`
- if only `3` new latest posts exist, the correct result of the incremental pass may be `3`, not a forced march into older backlog

If the product still wants "20 fresh posts total," the right sequence is:

1. run incremental
2. if it returns fewer than `20`, run a separate backfill continuation

Do not hide both behaviors inside one loop.

### 3. Store overlap anchors, not scroll positions

`scrollY` is not a crawl cursor. It is a debug metric.

Instead, store a small source-level overlap set after each successful crawl:

- oldest `3-5` stable post IDs in the tail of the successful run
- optionally the oldest fresh post ID captured in that run
- optionally the run timestamp and relative age band seen at that boundary

How to use it:

- next incremental run starts at top
- once those known anchors reappear with strong overlap, the crawler can conclude it has reached prior coverage
- if no fresh posts were found before that anchor boundary, stop incremental
- if more fresh posts are still needed, switch to backfill mode and continue past the anchor

Why this is strong:

- it is logical state, not viewport state
- it tolerates a small amount of feed movement
- it matches how ranked feeds are usually crawled in practice: by overlap detection, not by absolute position

### 4. Add adaptive skip mode when the seen ratio is high

Once the crawler proves it is in a stale zone, it should stop paying full cost on every screen.

Example trigger:

- first slice is `>= 80%` seen
- or two consecutive steps are `>= 85%` seen with zero fresh

Then switch behavior:

- increase scroll stride
- or alternate `jump -> probe -> jump -> probe`
- or only fully extract every Nth slice until novelty returns

The basic pattern is:

- dense inspection while novelty is high
- sparse probing while novelty is low

This is a standard crawl-budget optimization and is a good fit here.

### 5. Add a shallow probe phase before the main crawl decision

Before committing to a full crawl, inspect a small top slice:

- top `6-10` visible posts

Then branch:

- mostly fresh: continue normal incremental sweep
- mostly seen with good overlap to prior run: stop incremental early
- mostly seen but no anchor overlap yet: enter skip/probe mode
- mixed with many unidentified: collector quality problem, not just crawl depth

This gives the crawler a decision point instead of one rigid policy.

### 6. Measure `time to first fresh` explicitly

Add crawl metrics that answer traversal efficiency directly:

- `firstFreshPosition`
- `seenRatioFirst10`
- `seenRatioFirst20`
- `consecutiveSeenBeforeFirstFresh`
- `observedPerFresh`
- `freshAfterAnchor`

This is not just observability polish. It is how you tell whether a strategy improved the real bottleneck.

## Riskier Or More Complex Ideas

These may be valuable, but I would not start here.

### 1. Discovery/detail split

Split feed crawling from detail capture:

- feed pass discovers candidates quickly
- detail pass opens permalink/detail view only for selected fresh posts

This is a strong long-term pattern, but it does not solve the immediate "stale prefix" issue by itself. It helps once traversal policy is already sane.

### 2. Container-aware or card-aware jumping

Instead of fixed `1200px` page scrolling:

- jump by viewport multiples
- or scroll relative to the bottom-most visible post card
- or maintain a visible-card window and advance by card count rather than pixels

This could reduce overlap caused by feed virtualization, but it is more implementation-sensitive than the mode split and anchor approach.

### 3. Heuristic frontier scoring from post IDs or timestamps

You can probably use:

- post ID magnitude
- normalized relative time
- first-seen timestamps in local storage

to guess where novelty should resume.

I would only use this as a secondary hint, not the primary cursor. It is too easy to over-trust an ordering assumption that later breaks.

### 4. Permalink-led continuation

One possible pattern is:

- store a tail anchor permalink
- open it directly on the next run
- try to resume nearby or use it to locate the boundary

This might work in some cases, but Facebook feed behavior is not stable enough for me to recommend it first.

### 5. Browser-worker and scheduler redesign

The scale review is correct that long-term collection wants:

- worker ownership
- scheduler state
- source crawl state
- distinct incremental and backfill jobs

That is directionally right, but for this immediate bottleneck it is too much machinery unless you first prove the crawl policy you want.

## Ideas To Avoid

### 1. Do not use `scrollY` as the durable crawl cursor

It will not survive:

- layout shifts
- window size changes
- feed re-ranking
- reopened sessions
- different tab states

### 2. Do not keep one monolithic "scroll until 20 fresh" strategy

That policy hides two very different questions:

- how many truly new latest posts exist?
- how far should we backfill to find unseen older posts?

### 3. Do not treat "seen" as a reason to keep crawling deeper forever

A stale top slice does not always mean "more scrolls are needed."

Sometimes it means:

- there are few or no new latest posts since last crawl
- the run should stop
- or the run should switch modes explicitly

### 4. Do not promote provisional/unidentified posts into the frontier

Only stable IDs should define overlap anchors.

Unidentified observations are too noisy to use as durable crawl state.

### 5. Do not jump straight to multi-tab scraping as the fix

More tabs do not solve a bad traversal policy. They multiply it.

### 6. Do not rely on hidden endpoints or platform reverse engineering first

That adds fragility and account risk before the straightforward DOM crawl strategy has been made disciplined.

## Recommended Next Experiment Plan

This is the experiment plan I would run next, in order.

### Experiment 1: deterministic incremental latest sweep

Goal:

- prove that start-state variance is a major source of waste

Change in behavior:

- always navigate to the source URL
- verify `New posts`
- scroll to top
- inspect a shallow top window only

Suggested budget:

- top slice plus `2-3` additional scroll steps

Success criteria:

- `firstFreshPosition` improves materially
- `observedPerFresh` drops
- repeated runs become more predictable

### Experiment 2: overlap-anchor stop rule

Goal:

- stop incremental runs once prior coverage is re-entered

Change in behavior:

- store `3-5` tail anchor post IDs from the last successful crawl
- stop incremental once anchor overlap is confirmed

Expected outcome:

- runs that previously kept drifting into old posts should stop earlier
- if there are only a few new latest posts, the run should return a small number quickly

Success criteria:

- lower runtime on repeated incremental runs
- lower observed count before termination
- fewer old fresh posts leaking into a "latest" run

### Experiment 3: explicit backfill continuation

Goal:

- still get to `20` fresh when incremental alone does not reach it

Change in behavior:

- only after incremental stops early, begin a separate backfill phase
- seek past the anchor boundary and continue until target is hit or budget is exhausted

Expected outcome:

- clearer semantics
- cleaner metrics
- easier tuning because incremental and backfill costs are no longer mixed

Success criteria:

- combined incremental + backfill reaches `20` fresh more efficiently than the current single loop
- logs clearly show how much cost belonged to latest sweep vs backlog fill

### Experiment 4: adaptive jump/probe in stale zones

Goal:

- reduce waste inside long seen-prefix stretches

Change in behavior:

- when seen-ratio threshold is crossed, switch from dense inspection to skip/probe cadence

Suggested guardrail:

- probe every jump so new clusters are not skipped silently

Success criteria:

- lower observed-per-fresh in backfill mode
- no obvious miss rate compared with a control crawl

## Recommended Direction

If I had to pick the next move with no implementation in this pass, it would be:

1. deterministic preflight
2. incremental vs backfill split
3. overlap-anchor cursor
4. adaptive skip/probe once stale overlap is confirmed

That is the shortest path to a crawler that can get the latest fresh posts **repeatably** instead of just eventually.

The current crawler already knows what a fresh post is. The next job is teaching it what a stale region is, and what to do once it knows.
