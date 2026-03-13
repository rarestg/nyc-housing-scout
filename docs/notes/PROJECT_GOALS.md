# Project Goals

## Problem

Manual Facebook housing search is miserable.

Posts are inconsistent, incomplete, repetitive, and hard to compare. Important facts are buried in free-form text and screenshots. We want a system that turns those posts into structured listings we can search, sort, and later visualize on a map.

## Success Criteria

The system should eventually let us:

- ingest posts from housing groups/pages
- extract structured housing facts from messy inputs
- mark confidence / uncertainty when fields are inferred
- deduplicate repeated or cross-posted listings
- geocode locations when enough address/neighborhood detail exists
- browse results in a spreadsheet/table/map view
- filter by rent, rooms, borough, listing type, availability, and other constraints

## Non-Goals For Right Now

- perfect end-to-end automation on day one
- full browser automation before we know the data shape
- production-grade UI before extraction quality is decent

## Working Strategy

Start with a human-in-the-loop pipeline:

1. capture post text / screenshot / HTML
2. extract structured fields
3. save JSON
4. review uncertain values
5. refine rules and prompts
6. then automate more capture and geocoding

## Listing Types We Care About

- entire apartment rental
- room in shared apartment
- multiple rooms available in shared apartment
- sublet
- lease takeover
- roommate search
- short-term furnished stay
- uncertain / mixed

## Core Questions Per Listing

- What is it?
- Where is it?
- How much is it?
- How many rooms/bedrooms are involved?
- When is it available?
- Is it the full unit or a room situation?
- What evidence supports those conclusions?
