# Execution Plan

## Phase 0 — Bootstrap
- define schema
- define folder layout
- create starter extraction helpers
- collect sample inputs

## Phase 1 — Extraction Quality
- gather 20-50 representative posts
- test extraction from text first
- add HTML-aware extraction for cleaner metadata when available
- add screenshot/OCR pathway
- score confidence by field
- create review checklist for ambiguous posts

## Phase 2 — Data Cleanup
- normalize neighborhoods / boroughs
- normalize prices and room counts
- deduplicate similar listings
- classify listing type more reliably

## Phase 3 — Geocoding + Map
- geocode address/neighborhood candidates
- attach lat/lng + geocode confidence
- produce map-ready dataset
- add filtering and sorting

## Phase 4 — Capture Automation
- connect browser capture flow once the input path is stable
- automate saving raw post payloads
- keep manual fallback for weird posts

## Immediate Next Tasks
- choose the project name and repo policy
- collect sample posts
- confirm how raw Facebook data will be supplied in practice
- decide whether screenshots should be OCR’d locally or parsed by a multimodal model
- decide which geocoder to use first
