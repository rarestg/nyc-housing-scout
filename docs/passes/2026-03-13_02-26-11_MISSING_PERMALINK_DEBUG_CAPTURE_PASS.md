# Missing Permalink Debug Capture Pass — 2026-03-13

## Scope

This pass stayed narrowly focused on collector diagnostics for cards that finish with no recovered `postUrl`.

Goals:

- preserve broader href evidence for missing-`postUrl` cards
- preserve trimmed DOM context that helps separate true permalink absence from card/root misses
- avoid changing collector/storage semantics or adding compatibility scaffolding

Non-goals:

- no storage changes
- no migration work
- no attempt to synthesize new permalinks
- no queue or extraction redesign

## What Changed

### 1. Added targeted missing-`postUrl` debug context to DOM raw payloads

`src/browser/dom-extractor.js` now adds `debugMetadata.missingPostUrlContext` only when a card finishes with `postUrl: null`.

The new debug block captures:

- `searchRootCounts`
  - current header-root count and bounded top-slice root count
- `selectedCard`
  - trimmed text/html preview plus story-body/author/anchor counts for the chosen card
- `topSliceSnapshot`
  - a small snapshot of the bounded top-of-card roots already searched
- `cardAnchorEvidence`
  - broader raw href evidence from all anchors inside the chosen card, including:
    - raw `href`
    - normalized post URL if one exists
    - extracted post id if one exists
    - time hint from text / `aria-labelledby` / `aria-label` / `title`
- `ancestorSummaries`
  - trimmed previews for the first few ancestors above the chosen card
- `ancestorAnchorEvidence`
  - raw href evidence from those ancestors, excluding anchors already inside the chosen card

This keeps the pass diagnostic: collector output is unchanged except for extra raw debug data on the failure cases we care about.

### 2. Added fixture-style coverage for both diagnostic outcomes

`test/dom-extractor.test.js` now covers:

- a missing-`postUrl` card where the debug context shows only group/profile links plus trimmed card HTML
- a boundary-miss-style fixture where a parent container holds a real permalink and the new `ancestorAnchorEvidence` surfaces it

That second test is intentionally diagnostic: it proves the new debug path can distinguish "the chosen card missed an outer permalink" from "there is no permalink evidence nearby at all."

## Validation

Validated with:

- `npm test`
- `npm run capture:dom -- --limit 15`
- `npm run capture:dom -- --limit 25`

Live artifact paths from this pass:

- `data/raw/facebook/facebook-default/2026-03-13T06-25-37-861Z/Grace-Ahn-010.json`
- `data/raw/facebook/facebook-default/2026-03-13T06-25-56-661Z/Grace-Ahn-010.json`
- `data/raw/facebook/facebook-default/2026-03-13T06-25-56-661Z/Anonymous-member-016.json`

## What The New Evidence Suggests

The live missing-`postUrl` cards sampled in this pass point more strongly to **permalink absence in the visible DOM** than to an extractor root miss.

Observed pattern on both `Grace Ahn` and `Anonymous member`:

- `permalinkCandidates` is empty
- `headerSnapshot` is empty
- `cardAnchorEvidence` contains only:
  - profile/user links
  - or a group-page time link with a valid `labelledby` time
- `ancestorAnchorEvidence` is empty
- no normalized post URL or extractable post id appears in the chosen card or the first few ancestors above it

That is materially better evidence than the earlier "empty candidate list" alone, because it now shows:

1. what anchors actually existed inside the chosen card
2. what the bounded top slice looked like
3. whether nearby ancestors outside the chosen card held any missed permalink-like hrefs

Current conclusion:

- for the sampled live cards in this pass, the stronger hypothesis is **true permalink absence in the currently visible DOM**
- the new debug capture is now in place to prove the opposite quickly if a future missing-`postUrl` case exposes a post-like href in `ancestorAnchorEvidence`
