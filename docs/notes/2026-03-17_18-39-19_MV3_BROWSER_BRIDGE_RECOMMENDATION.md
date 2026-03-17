# MV3 Browser Bridge Recommendation

Use this note as design input when planning the multi-source collector runtime milestone.

This is not the execution bundle. It is an engineering recommendation for the browser-control boundary that should inform that bundle.

Use `docs/SHIP_PLAN.md` as the canonical source for locked runtime-topology decisions. This note defines the recommended browser boundary and implementation sequencing inside that larger milestone.

## Recommended Shape

Use a repo-owned Chrome integration, not a generic browser automation stack.

Recommended architecture:

- real logged-in Chrome tabs
- repo-owned MV3 Chrome extension
- tiny localhost bridge, using WebSocket or HTTP plus WebSocket
- Node browser client in this repo
- existing collector, scheduler, and SQLite-backed pipeline

Node should remain responsible for:

- collection logic
- source scheduling
- source-to-tab lease handling
- SQLite writes
- post-processing and downstream pipeline stages

The extension should remain intentionally narrow and browser-facing only.

## Why This Is The Recommended Direction

This project needs to read from a real signed-in Chrome tab that already has Facebook session state.

That makes the usual "just use Playwright or Puppeteer in its own browser" answer the wrong default.

A repo-owned Chrome bridge gives the project all of these at once:

- real Chrome session and cookies
- explicit tab discovery and targeting
- page-context JavaScript evaluation for the existing DOM extractors
- navigation and wait primitives on the same tab
- optional CDP network capture for GraphQL recovery
- minimal local-first deployment with no cloud dependency
- full control over multi-tab behavior instead of inheriting OpenClaw relay assumptions

It is also the closest match to the current collector shape, which lowers rewrite risk.

## What Problem This Actually Solves

Today the repo depends on OpenClaw for two different concerns:

- browser commands such as evaluate, navigate, wait, status, and tab control
- a private bridge into Chrome DevTools for network capture

The deeper issue is not extraction or storage. The issue is that browser ownership is still too implicit.

The collector should stop thinking in terms of:

- browser profile
- attached tab somewhere

It should instead think in terms of:

- this source owns this exact tab lease right now

## What The Extension Should Do

The extension should:

- attach to an existing Chrome tab with `chrome.debugger`
- maintain a registry of attached tabs with `tabId`, target/session identity, and health metadata
- expose loopback-only RPC to local Node
- forward the raw CDP commands and events needed by the collector
- support tab open, focus, close, list, and attach operations
- reattach after navigation, transient disconnects, or MV3 service-worker restart
- persist enough state to recover attached tabs after service-worker restart

The extension should not:

- contain crawl policy
- contain extraction rules
- own storage logic
- own queue logic
- become the collector brain

## What The Node Side Should Do

The repo should own a thin browser client with methods along these lines:

- `listTabs()`
- `attachTab(tabId)`
- `evaluate(targetId, fn)`
- `navigate(targetId, url)`
- `wait(targetId, condition)`
- `enableNetworkCapture(targetId, options)`
- `drainNetworkCapture(targetId)`

This client should replace the current OpenClaw wrapper while leaving the existing DOM extractor and most crawl logic in Node.

## Required Browser Primitives

The replacement must explicitly support:

- tab discovery
- stable tab targeting
- evaluation in the live page context
- navigation in the targeted tab
- waits for time, DOM readiness, URL changes, and JavaScript conditions
- optional CDP network capture and response-body access
- health checks for the attached tab and debugger session
- reattach and recovery after navigation or transient disconnects

These are the real requirements. Everything else is secondary convenience.

## Recommended Multi-Source Runtime Model

Start with:

- one signed-in Chrome session
- two to four leased Facebook group tabs
- one active crawl per leased tab
- explicit source-to-tab mapping in local state
- a scheduler that assigns the next eligible source to a free tab

Do not rely on:

- whatever tab is attached
- first available tab fallback
- profile-level ambiguity as collector context

The durable abstraction should be:

- one browser session owns many tabs
- one tab lease belongs to one source at a time
- one crawl job runs on one leased tab at a time

## Why Not The Other Options

### Not Playwright or Puppeteer as the primary runtime

They are the wrong default because the project wants the user's real active Chrome session, not a separate automation browser.

### Not generic remote-debugging attachment as the main long-term boundary

Direct ad hoc attachment to the user's normal Chrome may work in narrow cases, but it is a weaker portability and ownership story than a repo-owned bridge.

### Not Chrome DevTools MCP as the collector runtime

DevTools MCP can remain useful for operator debugging, but it should not become the production collector runtime. The collector needs a small owned local control surface instead.

## What Can Stay From The Current Collector

Keep:

- SQLite as the source of truth
- raw artifacts on disk
- DOM-first extraction
- the current collected-post and processing pipeline shape
- most network-enrichment normalization logic

Change:

- the browser boundary
- the assumption that browser profile equals collector context
- the crawl runtime so it always operates on explicit tab leases

## Recommended Phasing

These are browser-boundary implementation phases, not standalone milestone-completion claims. The overall multi-source runtime milestone is only done once explicit source/tab lease semantics and live multi-source validation are in place as well.

### Phase 1

Deliver DOM-only parity without OpenClaw:

- identify Facebook group tabs
- attach a tab
- evaluate DOM extractor functions in that tab
- navigate and wait in that tab
- run the current capture and crawl commands against an explicit target
- remove profile-scoped ambiguity from the collector

If this phase succeeds, OpenClaw is no longer required for basic DOM collection.

This phase should be treated as:

- a necessary prerequisite for the new boundary
- not yet sufficient for claiming the multi-source runtime milestone is complete

### Phase 2

Restore network-assisted identity recovery:

- `Network.enable`
- request and response event handling
- response-body reads
- filtering and draining relevant GraphQL traffic
- reuse of the repo's existing merge logic

This matters, but it comes after explicit tab ownership works.

This phase should be treated as:

- restoration of current active-crawl capability on the new bridge
- still not sufficient by itself for claiming the full milestone is complete

### Phase 3

Add the minimal local scheduler and lease runtime for multiple tabs and multiple groups.

Only after those phases should the project consider multiple Chrome sessions or profiles.

This is the first phase that can satisfy the milestone’s core product/runtime requirement:

- continuous multi-source ingest on one machine without source collisions

In practice, the milestone should not be considered complete until enough of Phases 1 through 3 have landed to satisfy the live validation gates described in the PM planning brief.

## Recommended Sequencing For Dispatch

The future execution bundle should assume this dependency shape unless a newer review changes it:

1. freeze the bridge protocol and runtime ownership contract first
2. allow the MV3 extension skeleton and the runtime lease/storage contract to proceed in parallel once that contract is stable
3. migrate the Node browser client and collector CLIs after the protocol surface is concrete
4. land recovery and validation work only after the bridge and lease model are real enough to exercise end-to-end

Do not dispatch the work as one undifferentiated “replace OpenClaw” implementation stream.

## Dispatch-Level Acceptance Gates

Any execution bundle built from this recommendation should make these gates explicit:

1. the active collection path runs without OpenClaw in the runtime path
2. no collector command falls back to “first attached tab” or profile-level ambiguity
3. at least two real sources can run on separate leased tabs without cross-source contamination
4. manager restart, relay reconnect, and navigation-triggered detach all recover cleanly or fail loudly with explicit health state
5. the new bridge supports both DOM collection and the CDP-assisted identity-recovery path needed by the current collector
6. downstream queue processing can operate concurrently with collection without unsafe ownership behavior

If a future implementation closes browser parity but not these gates, it should be reported as an intermediate phase close rather than a full milestone close.

## Key Risks And Constraints

The main operational constraint is Facebook session durability, not storage scale.

The design should assume:

- Facebook auth lives in the user's real Chrome profile
- the extension never owns credentials
- debugger attachment can be displaced by DevTools or user actions
- navigation can temporarily break attachment and must be recovered
- MV3 service workers restart and lose in-memory state unless persisted

## Non-Goals

Do not:

- add distributed infrastructure to solve this
- migrate the repo to Postgres
- turn the extension into the collector brain
- rebuild the extraction pipeline in the browser
- make headless automation browsers the primary path

## How To Use This Note

When a PM prepares the future runtime execution bundle, read this note alongside:

- `docs/notes/2026-03-17_16-40-27_PM_HANDOFF_AND_NEXT_MILESTONE.md`
- `docs/notes/2026-03-17_18-32-59_PM_PLANNING_BRIEF_MULTI_SOURCE_RUNTIME.md`
- `docs/SHIP_PLAN.md`

Treat this note as the current recommended browser-boundary input unless a newer review explicitly replaces it.
