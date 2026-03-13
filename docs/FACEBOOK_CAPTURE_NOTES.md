# Facebook Capture Notes

## Immediate Goal

Extract useful listing data from Facebook housing group posts while ignoring the mountains of wrapper HTML, duplicated chrome, reactions, comments, and UI junk.

## What We Care About From A Post Card

### Feed-level metadata
- author name
- post URL
- posted time text
- group/page context

### Listing content
- full expanded post text (`See more` must be expanded)
- structured sections inside the post body
- image URLs if present

### Optional engagement/context
- comment count
- selected comments that materially clarify availability, pricing, or status

## What We Explicitly Want To Ignore
- repeated `Facebook` blockquote wrappers
- reaction toolbars
- like/comment/send buttons
- comment composer UI
- random image alt text unless it is the only available clue
- duplicated anchor text from obfuscated metadata spans
- profile picture/image markup
- post action menus

## DOM Heuristics From This Sample

Useful selectors / attributes seen in the provided HTML:
- post body container: `[data-ad-rendering-role="story_message"]`
- author name: `[data-ad-rendering-role="profile_name"]`
- post meta/time area: links around the post permalink in the header
- comment count / reactions exist lower in the card and should not be treated as listing content

Noise patterns seen in the sample:
- repeated `blockquote` with the text `Facebook`
- giant repeated button/link wrappers
- comment threads and reaction bars appended after the main story content
- image grids and external link preview wrappers that may duplicate the post title

## Desired Capture Workflow

Best case via browser relay:
1. open group feed
2. set sort to `New posts`
3. expand `See more` for each candidate post
4. capture one post card at a time
5. save:
   - post URL
   - author
   - expanded text
   - relevant image URLs
   - raw HTML snippet for the post card

## MVP Rule

If we can only capture one thing reliably, capture **expanded post text + post URL**. That alone gets us very far.

## Sample Post Observations

The Williamsburg sample is really multiple offerings bundled into one post:
- part-time room / short stay option
- entire 2BR available for specific date windows

That means one Facebook post may need to produce **multiple normalized listing records**.

## Product Implication

Our schema/pipeline should support:
- one source post
- many extracted listing candidates

rather than assuming one post = one listing.
