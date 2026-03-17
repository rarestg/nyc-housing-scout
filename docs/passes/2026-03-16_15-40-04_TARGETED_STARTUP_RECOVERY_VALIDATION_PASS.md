# Targeted Startup Recovery Validation Pass

## 1. Scope

Run one targeted live validation pass against Williamsburg to answer the remaining empirical question after the CDP corrective pass:

- does the corrected pre-navigation CDP path reliably see first-navigation startup GraphQL traffic?
- what exactly is in that startup burst?
- does startup-captured traffic materially improve recovery for early/top-slice weak-identity posts?
- should `cdp + --navigate-before-crawl` become the default Facebook capture mode now?

This stayed a validation pass. No code changes were needed.

## 2. Files Changed

- `docs/passes/2026-03-16_15-40-04_TARGETED_STARTUP_RECOVERY_VALIDATION_PASS.md`
- `docs/passes/README.md`

## 3. Exact Commands Run

Context / required reads:

```bash
sed -n '1,220p' README.md
sed -n '1,240p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,280p' docs/PIPELINE.md
sed -n '1,240p' data/README.md
sed -n '1,260p' docs/passes/2026-03-15_18-23-42_DEEP_UNIDENTIFIED_FORENSICS_PASS.md
sed -n '1,260p' docs/passes/2026-03-15_20-10-07_NETWORK_FIRST_INTEGRATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_00-06-53_NETWORK_IDENTITY_RESOLVER_CORRECTIVE_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_10-39-18_PRE_NAVIGATION_CDP_CAPTURE_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_10-59-55_PRE_NAVIGATION_CDP_CAPTURE_CORRECTIVE_PASS.md
sed -n '1,260p' src/browser/cdp-network-capture.js
sed -n '1,320p' src/browser/network-capture.js
sed -n '1,260p' src/browser/facebook-response-parser.js
sed -n '1,260p' src/browser/facebook-post-normalizer.js
sed -n '1,260p' src/core/browser-pipeline.js
sed -n '1,260p' src/core/collected-post.js
sed -n '1,260p' src/cli/crawl-dom-latest.network-integration.js
sed -n '1,360p' src/cli/crawl-dom-latest.js
sed -n '360,980p' src/cli/crawl-dom-latest.js
sed -n '220,980p' src/browser/cdp-network-capture.js
git status --short
```

Browser state / cold-start reset:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
openclaw browser --browser-profile chrome navigate about:blank
openclaw browser --browser-profile chrome wait --time 1500
```

Live bounded validation:

```bash
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --network-capture-mode cdp --navigate-before-crawl
```

Baseline and artifact inspection:

```bash
node src/cli/inspect-storage.js runs --source-key williamsburggreenpointhousing --limit 8
node src/cli/inspect-storage.js runs --source-key williamsburggreenpointhousing --limit 2
node src/cli/inspect-storage.js observations --run-id 2026-03-16T14-37-41-477Z --limit 40 --full
node src/cli/inspect-storage.js observations --run-id 2026-03-16T14-58-58-454Z --limit 40 --full
node src/cli/inspect-storage.js observations --run-id 2026-03-16T19-38-04-372Z --limit 20 --full
node src/cli/inspect-storage.js run-steps --run-id 2026-03-16T14-37-41-477Z --limit 20
node src/cli/inspect-storage.js run-steps --run-id 2026-03-16T19-38-04-372Z --limit 20
node src/cli/inspect-storage.js validate-run --run-id 2026-03-16T19-38-04-372Z
```

Targeted JSON inspection:

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
const runIds = ['2026-03-16T14-37-41-477Z','2026-03-16T14-58-58-454Z'];
for (const runId of runIds) {
  const file = `data/raw/facebook/williamsburggreenpointhousing/${runId}/network-capture-${runId}.json`;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const summary = {
    runId,
    transport: data.transport,
    startup: data.startup,
    summary: data.summary,
    integration: data.integration,
    stepPhases: data.drains?.map((d) => ({ phase: d.phase, captured: d.capturedThisDrain, stepIndex: d.stepIndex })) || [],
  };
  console.log(JSON.stringify(summary, null, 2));
}
NODE

node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { extractFacebookPostCandidatesFromEnvelopeItem } from './src/browser/facebook-post-normalizer.js';
const runIds = ['2026-03-16T14-37-41-477Z','2026-03-16T14-58-58-454Z','2026-03-16T19-38-04-372Z'];
for (const runId of runIds) {
  const file = `data/raw/facebook/williamsburggreenpointhousing/${runId}/network-capture-${runId}.json`;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const startupItems = data.items.filter((item) => item.capturePhase === 'startup-after-navigate');
  const startupCandidates = startupItems.flatMap((item) => extractFacebookPostCandidatesFromEnvelopeItem(item));
  const laterItems = data.items.filter((item) => item.capturePhase !== 'startup-after-navigate');
  const laterCandidates = laterItems.flatMap((item) => extractFacebookPostCandidatesFromEnvelopeItem(item));
  console.log(JSON.stringify({
    runId,
    startupItemCount: startupItems.length,
    startupCandidateCount: startupCandidates.length,
    laterItemCount: laterItems.length,
    laterCandidateCount: laterCandidates.length,
  }, null, 2));
}
NODE

node --input-type=module - <<'NODE'
import fs from 'node:fs';
const runId='2026-03-16T19-38-04-372Z';
const data = JSON.parse(fs.readFileSync(`data/raw/facebook/williamsburggreenpointhousing/${runId}/network-capture-${runId}.json`, 'utf8'));
console.log(JSON.stringify(data.items[0], null, 2));
console.log(JSON.stringify({
  fbApiReqFriendlyName: data.items[0]?.fbApiReqFriendlyName,
  docId: data.items[0]?.docId,
  matchHints: data.items[0]?.matchHints,
  responseBodyLength: data.items[0]?.responseBodyLength,
}, null, 2));
NODE

node --input-type=module - <<'NODE'
import fs from 'node:fs';
const runIds = ['2026-03-16T14-37-41-477Z','2026-03-16T14-58-58-454Z','2026-03-16T19-38-04-372Z'];
for (const runId of runIds) {
  const data = JSON.parse(fs.readFileSync(`data/raw/facebook/williamsburggreenpointhousing/${runId}/network-capture-${runId}.json`, 'utf8'));
  const rows = (data.graphQlRequests || []).map((r) => ({
    ts: r.requestTimestamp,
    friendly: r.fbApiReqFriendlyName,
    docId: r.docId,
    inspect: r.shouldInspectResponse,
    target: r.hasTargetGroupId,
  }));
  console.log(JSON.stringify({ runId, rows }, null, 2));
}
NODE

node --input-type=module - <<'NODE'
import { createStorage } from './src/storage/storage.js';
import path from 'node:path';
const storage = createStorage({ dataDir: path.resolve('data') });
const runIds = ['2026-03-16T14-37-41-477Z','2026-03-16T14-58-58-454Z','2026-03-16T19-38-04-372Z'];
for (const runId of runIds) {
  const steps = storage.listRunSteps({ runId, limit: 10 });
  const observations = storage.listObservations({ runId, limit: 50, full: true });
  console.log(JSON.stringify({
    runId,
    step0: steps.find((s) => s.stepIndex === 0),
    step1: steps.find((s) => s.stepIndex === 1),
    counts: {
      observations: observations.length,
      fresh: observations.filter((o) => o.freshness === 'fresh').length,
      seen: observations.filter((o) => o.freshness === 'seen').length,
      unidentified: observations.filter((o) => o.freshness === 'unidentified').length,
      networkRecovered: observations.filter((o) => o.captureHints?.networkEnrichment?.identityRecovered).length,
    },
  }, null, 2));
}
storage.close();
NODE
```

Repo validation:

```bash
npm run inspect:storage -- validate-run --run-id 2026-03-16T19-38-04-372Z
npm test
```

## 4. Live Run Ids

- New targeted cold-start validation run: `2026-03-16T19-38-04-372Z`
- Prior baseline used from the first pre-nav pass: `2026-03-16T14-37-41-477Z`
- Prior baseline used from the corrective pass: `2026-03-16T14-58-58-454Z`

## 5. Startup Request Inventory

New run `2026-03-16T19-38-04-372Z`, startup window only:

- Total startup GraphQL requests: `15`
- Startup inspectable requests: `1`
- Startup captured envelopes: `1`

Inspectable startup request:

- `useGroupsCometVisitMutation` — `doc_id=26160699310201928`
  - request carried `group_id=2664056243718928`
  - response carried group/bookmark metadata only
  - no `postIds`, `storyIds`, or `feedbackIds`
  - retained as `small_response_full_text`

Non-inspectable startup requests observed:

- `MAWSecureThreadQPContainerQuery` — `24407836128822485`
- `MWChatTabInThreadBannerQuery` — `24686790901001702`
- `FBYRPTimeLimitsEnforcementQuery` — `25203298649264493`
- `fetchMWChatVideoAutoplaySettingQuery` — `9713919638685405`
- `CometNotificationsDropdownQuery` — `26603407895919495`
- `CometMessagingJewelDropdownEBUpsellContainerQuery` — `25961980840158091`
- `CometSearchBootstrapKeywordsDataSourceQuery` — `29553238020988861`
- `OhaiWebClientMessengerConfigsQuery` — `25661686400163633`
- `MWQuickPromotionThreadViewBannerContainerQuery` — `24262581233432542`
- `useMWEncryptedBackupsFetchBackupIdsV2Query` — `25220416984279164`
- `RTWebCallBlockSettingHooksQuery` — `9989124061109700`
- `MWAnimatedImageControlsUtilCometSettingsQuery` — `9834610223284602` (twice)
- `MAWVerifyThreadCutover_ContactCapabilities2Query` — `9948369021930229`

Likely canonical-story carrier, but not in startup:

- `GroupsCometFeedRegularStoriesPaginationQuery` — `doc_id=26731644009775127`
  - appeared twice in the first `after-scroll` phase
  - both requests were inspectable and both were retained as `high_signal_full_text`
  - these were the actual story-bearing envelopes

## 6. Startup Captured Envelope Inventory

Across all three compared runs (`14:37`, `14:58`, `19:38`) the startup envelope shape was the same:

- `captureId=netcap_0001`
- `capturePhase=startup-after-navigate`
- `fbApiReqFriendlyName=useGroupsCometVisitMutation`
- `docId=26160699310201928`
- `captureMode=full_text`
- `retentionReason=small_response_full_text`
- `responseBodyLength=1829`
- `hasTargetGroupId=true`
- `postIds=[]`
- `storyIds=[]`
- `feedbackIds=[]`
- normalized startup post candidates: `0`

Startup envelope conclusion:

- startup capture is now real and stable on first navigation
- the startup envelope is inspectable and fully captured
- it is not a canonical story carrier
- it does not normalize into a recoverable post candidate

## 7. Early / Top-Slice Post Outcomes

New run `2026-03-16T19-38-04-372Z`:

- Step `0` top slice produced one post:
  - `Nick De Bellis`
  - `postId=24528677210163517`
  - `fresh`
  - DOM already had stable `postId` and `postUrl`
  - no network recovery occurred
- Step `1` and `2` added three already-identified seen posts:
  - `Bazar Ke Pandit`
  - `Jacqueline Duncan`
  - `Neha Manchanda`
- All three later network merges were `exact_identity` matches from the first `after-scroll` feed envelope
- `recoveredIdentityCount = 0`
- `unidentifiedCollected = 0`

Practical result:

- no early/top-slice weak-identity post appeared in this live window
- no formerly unidentified-style top-slice post became identified
- the bounded cold-start run therefore produced no empirical recovery win

## 8. Before / After Comparison To Prior Runs

`2026-03-16T14-37-41-477Z`:

- first proof that startup traffic was visible
- startup summary still included later scroll feed requests
- reported `startup graphQlRequestCount=15`, `startup inspectableCount=3`
- still only one startup envelope and `recoveredIdentityCount=0`

`2026-03-16T14-58-58-454Z`:

- corrective pass fixed startup-window accounting
- startup summary dropped to `graphQlRequestCount=13`, `inspectableCount=1`
- startup envelope remained only `useGroupsCometVisitMutation`
- `recoveredIdentityCount=0`

`2026-03-16T19-38-04-372Z`:

- true cold-start run after explicit `about:blank` reset
- startup summary stayed in the corrected shape: `graphQlRequestCount=15`, `inspectableCount=1`
- startup envelope again remained only `useGroupsCometVisitMutation`
- actual story carrier again appeared only in `after-scroll`
- `recoveredIdentityCount=0`
- top slice changed live, but the new top post was already DOM-identified

Net comparison:

- startup visibility is now validated and repeatable
- startup canonical-story recovery is still not demonstrated
- the live Williamsburg top slice in all three bounded runs contained no startup-recoverable weak-identity case

## 9. Whether Startup Capture Materially Improved Recovery

No.

What improved:

- startup blindness is gone
- first-navigation GraphQL traffic is reliably visible on a cold start
- startup request types, friendly names, and doc ids are now directly observable

What did not improve:

- no startup envelope normalized into a post candidate
- no early/top-slice post gained identity from startup traffic
- `recoveredIdentityCount` stayed `0` in all compared bounded pre-nav CDP runs

## 10. Recommendation On Default Capture Mode

Do not make the combined `cdp + --navigate-before-crawl` path the default Facebook capture mode yet.

Recommendation split:

- `cdp` transport itself: yes, it is now validated enough to keep preferring it when available
- `--navigate-before-crawl`: no, keep it opt-in for targeted validation until there is evidence of a real recovery win

Reason:

- the cold-start CDP path is technically correct
- the startup burst is still dominated by non-story requests plus one group-visit mutation
- the canonical story carrier still arrives after the first scroll
- this pass did not show a material early/top-slice recovery improvement

## 11. Remaining Blockers

- Wrong startup request type for recovery:
  - the captured startup envelope is `useGroupsCometVisitMutation`, not a story payload
- Late arrival of the canonical story carrier:
  - `GroupsCometFeedRegularStoriesPaginationQuery` still appears after the first scroll, not in startup
- Current live feed behavior:
  - this Williamsburg window did not expose any early/top-slice weak-identity DOM posts to recover

Not the blocker in this pass:

- not a CDP plumbing issue
- not a non-inspectable startup body issue
- not a parser failure
- not a normalizer failure on the captured story-bearing envelopes

## 12. Next Highest-Value Pass

Run the same bounded cold-start validation against a live window that actually contains early/top-slice weak-identity posts.

Concretely:

- keep the exact same bounded shape
- use `cdp + --navigate-before-crawl`
- repeat only when the top slice includes one or more DOM-weak posts
- then compare whether those posts become identified from startup or first-scroll network envelopes

Until that window exists, the remaining question is feed-behavior availability, not capture correctness.
