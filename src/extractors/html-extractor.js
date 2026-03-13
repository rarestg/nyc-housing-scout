import { extractListingsFromPost, extractListingsFromText } from './text-extractor.js';

export function extractFromHtml(html, post = null) {
  const listings = extractListingsFromHtml(html, post);
  return listings[0] ?? null;
}

export function extractListingsFromHtml(html, post = null) {
  const cleaned = extractUsefulTextFromFacebookHtml(html);
  const listings = post
    ? extractListingsFromPost({ ...post, bodyText: cleaned })
    : extractListingsFromText(cleaned);

  return listings.map((listing) => {
    listing.notes.rawSignals.push('html_input');
    return listing;
  });
}

function extractUsefulTextFromFacebookHtml(html) {
  const source = String(html || '');

  const storyMatch = source.match(/data-ad-rendering-role="story_message"[\s\S]*?<\/div><\/div><\/div>/i);
  const preferredChunk = storyMatch ? storyMatch[0] : source;

  return preferredChunk
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/Facebook/g, ' ')
    .replace(/Like|Comment|Send|View more comments/gi, ' ')
    .replace(/\s*Messaged!!\s*/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
