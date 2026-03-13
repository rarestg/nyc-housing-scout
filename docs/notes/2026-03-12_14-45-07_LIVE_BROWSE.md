# Live Browse Notes — 2026-03-12

Source tab:
- Group: Williamsburg Greenpoint Housing
- URL: https://www.facebook.com/groups/2664056243718928/
- Sort state observed: `New posts`

## What worked
- OpenClaw browser control could reach the attached Chrome tab via the `chrome` browser profile.
- The page snapshot exposes usable post structure, including:
  - author name
  - permalink URL
  - expanded body text when visible
  - image links
  - comment count
  - comments
  - `See more` buttons for truncated posts

## First useful observed posts

### 1) Michaela Kerem
Permalink:
- https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24492404357124136/

Observed content:
- "A few housing options in my Williamsburg 2BR apartment coming up!"
- Part-time room option
- Entire 2BR option
- Comment thread includes demand/context

Important product lesson:
- one post can contain multiple offerings

### 2) Fareed Khan
Observed title:
- "ISO subletter in Williamsburg (April 1-May 17)"

Observed visible text before expansion:
- 2 bed / 1 bath apartment
- 2nd floor walk up
- 6-minute walk to Lorimer L
- 8 minutes to Marcy J/M
- in-unit washer/dryer
- dishwasher
- roommate + two cats
- work-from-home / Manhattan commute framing
- still has a `See more` button, so visible text is partial

### 3) Duke Winn
Observed title:
- "Sublet my extra bedroom in 2b1b apartment in Williamsburg"

Observed from image alt text / card:
- bedroom in Williamsburg
- likely $1500/month bedroom option
- possible full sublease around $3250/month
- transit references: Bedford L, Lorimer Metropolitan L/G, Marcy J/M/Z

## Immediate extraction opportunities
- prioritize posts with visible permalink + visible body text
- click `See more` when present
- capture permalink + expanded text + image URLs
- optionally capture comments that clarify availability/status

## DOM refs observed during live browse
- sort button: `e570`
- Michaela post permalink: `e727`
- Fareed `See more`: `e1351`

## Next useful browser actions
1. click `See more` on truncated posts
2. open/capture individual permalinks
3. save structured raw captures for the first 10-20 posts
