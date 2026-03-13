# Worklog

Short running notes for important decisions and progress. Keep terse.

## 2026-03-12

- Moved from ad-hoc scraping toward a staged pipeline model.
- Chose SQLite as the system of record, with raw artifacts on disk.
- Chose a storage interface first, then implemented SQLite behind it.
- Improved collector metadata and listing extraction via targeted passes.
- Confirmed the main remaining bottleneck is crawl strategy / traversal policy, not storage.
- Agreed that structured LLM extraction should be a core pipeline stage.
- Agreed that each stage should be independently operable and testable via its own CLI surface.
