# Override Model And Review API Pass

## What changed

- added atomic `applyManualOverrideAction(...)` in `src/storage/sqlite-storage.js`
  - `set` actions create or update `manual_overrides`
  - `clear` actions clear the existing row
  - every action appends one `audit_events` row in the same transaction
  - audit payloads now capture the prior and next manual state for the field
- kept the effective-value contract unchanged:
  - active manual override
  - accepted resolved field
  - raw extracted listing value
  - raw observation-derived fallback
- updated the dashboard review read model so active manual overrides suppress resolved-location review reasons for the overridden field without hiding the underlying `resolved_fields` row
- extended `GET /api/dashboard/review/:reviewId` to expose `actions.manualOverride`
- added Review-only write endpoints in `src/ui/inspection-server.js`
  - `POST /api/dashboard/review/manual-overrides`
  - `POST /api/dashboard/review/manual-overrides/clear`
- added forensic CLI inspection surfaces in `src/cli/inspect-storage.js`
  - `manual`
  - `audit`

## Why it matters

- Review can now persist create/update/clear correction actions durably instead of faking manual state in the client
- override writes immediately flow through the same layered listing/review read model used everywhere else
- Debug stays forensic because the only write path lives under the Review API namespace

## Validation

- `node --test test/evidence-resolution-storage.test.js test/dashboard-api.test.js test/storage-inspection.test.js`
- `node --test test/inspect-ui.test.js`
- `npm run inspect:ui -- --port 0`
  - verified:
    - `GET /api/dashboard/review/ambiguous:<listingId>?queue=ambiguous`
    - `POST /api/dashboard/review/manual-overrides`
    - `POST /api/dashboard/review/manual-overrides/clear`
- `npm run inspect:storage -- manual --target-kind listing_record --target-id <listingId> --limit 5`
- `npm run inspect:storage -- audit --target-kind listing_record --target-id <listingId> --limit 5`
- `npm test`

## Follow-up

- Worker 6 can now build Review correction controls directly on top of the Review API without inventing a parallel client-side override model.
