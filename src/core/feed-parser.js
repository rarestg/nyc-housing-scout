export function parseFacebookFeedSnapshot(snapshotText) {
  const lines = String(snapshotText || '').split('\n');
  const posts = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/link\s+"(?:\d+\s+hours? ago|\d+\s+hour ago|\d+\s+minutes? ago|Yesterday|Just now|\d+h)"/.test(line)) continue;

    const post = parsePostAtPermalink(lines, i);
    if (!post) continue;
    if (posts.some((existing) => existing.dedupeKey === post.dedupeKey)) continue;
    posts.push(post);
  }

  return posts;
}

function parsePostAtPermalink(lines, permalinkIndex) {
  const postedAtText = extractQuotedText(lines[permalinkIndex]);
  const postRef = lines[permalinkIndex].match(/\[ref=(e\d+)\]/)?.[1] ?? null;

  let postUrl = null;
  for (let i = permalinkIndex; i < Math.min(lines.length, permalinkIndex + 4); i += 1) {
    const urlMatch = lines[i].match(/\/url:\s+(.+)/);
    if (!urlMatch) continue;
    const candidate = cleanupUrl(urlMatch[1]).replace(/^"|"$/g, '');
    if (/facebook\.com\/groups\/.*\/posts\//.test(candidate)) {
      postUrl = candidate;
      break;
    }
  }

  const authorHeadingIndex = findAuthorHeadingIndex(lines, permalinkIndex);
  if (authorHeadingIndex === -1) return null;
  const authorName = normalizeAuthorName(extractQuotedText(lines[authorHeadingIndex]));
  if (!authorName || isNonPostHeading(authorName)) return null;

  const bodyStartIndex = findBodyStartIndex(lines, permalinkIndex);
  if (bodyStartIndex === -1) return null;
  const bodyEndIndex = findBodyEndIndex(lines, bodyStartIndex);
  const bodyLines = lines.slice(bodyStartIndex, bodyEndIndex + 1);
  const bodyText = cleanBodyLines(bodyLines).join('\n').trim();

  const seeMoreRef = bodyLines.find((line) => /button\s+"See more"/.test(line))?.match(/\[ref=(e\d+)\]/)?.[1] ?? null;
  const joinedBody = bodyLines.join('\n');
  const imageUrls = Array.from(joinedBody.matchAll(/\/url:\s+(https:\/\/www\.facebook\.com\/photo\/\?fbid[^\s]+)/g)).map((m) => cleanupUrl(m[1]));
  const videoUrls = Array.from(joinedBody.matchAll(/\/url:\s+(https:\/\/www\.facebook\.com\/[^\s]*videos\/[^\s]*)/g)).map((m) => cleanupUrl(m[1]));
  const commentsCount = extractCommentsCount(lines, bodyEndIndex);
  const comments = extractComments(lines, bodyEndIndex);
  const postId = extractPostId(postUrl) || extractPostIdFromBodyUrls(joinedBody);

  if (!bodyText || isNonPostHeading(bodyText)) return null;

  return {
    dedupeKey: postId || `${authorName}|${postedAtText}|${bodyText.slice(0, 80)}`,
    postId,
    authorName,
    postUrl,
    postedAtText,
    postRef,
    seeMoreRef,
    bodyText,
    imageUrls: Array.from(new Set(imageUrls)),
    videoUrls: Array.from(new Set(videoUrls)),
    commentsCount,
    comments,
  };
}

function findAuthorHeadingIndex(lines, permalinkIndex) {
  for (let i = permalinkIndex; i >= Math.max(0, permalinkIndex - 25); i -= 1) {
    if (/heading\s+"[^"]+"\s+\[level=2\]/.test(lines[i])) return i;
  }
  return -1;
}

function findBodyStartIndex(lines, permalinkIndex) {
  for (let i = permalinkIndex; i < Math.min(lines.length, permalinkIndex + 80); i += 1) {
    if (/strong\s+\[ref=e\d+\]:/.test(lines[i])) return i;
    if (/generic\s+\[ref=e\d+\]:\s.+/.test(lines[i]) && /Williamsburg|Bushwick|room|sublet|apartment|bedroom|bath|rent|\$|available|lease|ISO/i.test(lines[i])) return i;
    if (/button\s+"See more"/.test(lines[i])) return Math.max(permalinkIndex, i - 3);
  }
  return -1;
}

function findBodyEndIndex(lines, bodyStartIndex) {
  for (let i = bodyStartIndex; i < Math.min(lines.length, bodyStartIndex + 220); i += 1) {
    if (/toolbar\s+"See who reacted to this"|button\s+"Like"|button\s+"Leave a comment"|article\s+"Comment by/.test(lines[i])) return i - 1;
  }
  return Math.min(lines.length - 1, bodyStartIndex + 220);
}

function cleanBodyLines(lines) {
  const out = [];
  for (const line of lines) {
    const cleaned = cleanSnapshotLine(line);
    if (!cleaned) continue;
    if (isNoiseText(cleaned)) continue;
    if (out[out.length - 1] === cleaned) continue;
    out.push(cleaned);
  }
  return out;
}

function cleanSnapshotLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^blockquote|^img\s|^button\s+"Actions for this post"|^group\s+"Video player"|^slider\s|^status\s+"Loading/.test(trimmed)) return null;

  return trimmed
    .replace(/^[- ]+/, '')
    .replace(/^generic\s+\[ref=e\d+\]:\s*/, '')
    .replace(/^strong\s+\[ref=e\d+\]:\s*/, '')
    .replace(/^text:\s*/, '')
    .replace(/^link\s+"([^"]+)"\s+\[ref=e\d+\]\s+\[cursor=pointer\]:$/, '$1')
    .replace(/^heading\s+"([^"]+)"\s+\[level=3\]\s+\[ref=e\d+\]:$/, '$1')
    .replace(/^heading\s+"([^"]+)"\s+\[level=2\]\s+\[ref=e\d+\]:$/, '$1')
    .trim();
}

function extractCommentsCount(lines, fromIndex) {
  for (let i = fromIndex; i < Math.min(lines.length, fromIndex + 40); i += 1) {
    const match = lines[i].match(/button\s+"(\d+) comments"/);
    if (match) return Number(match[1]);
  }
  return 0;
}

function extractComments(lines, fromIndex) {
  const comments = [];
  for (let i = fromIndex; i < Math.min(lines.length, fromIndex + 120); i += 1) {
    const line = lines[i];
    if (/article\s+"Comment by/.test(line)) continue;
    const cleaned = cleanSnapshotLine(line);
    if (!cleaned) continue;
    if (/^Comment by|^Like$|^Reply$|^React$|^Hide or report this$|^1h$|^2h$/.test(cleaned)) continue;
    if (!/interested|available|messaged|sublet|room|rent|month|april|may|july|august/i.test(cleaned)) continue;
    if (comments[comments.length - 1] === cleaned) continue;
    comments.push(cleaned);
    if (comments.length >= 8) break;
  }
  return comments;
}

function extractPostId(url) {
  if (!url) return null;
  const match = url.match(/posts\/(\d+)/);
  return match ? match[1] : null;
}

function extractPostIdFromBodyUrls(text) {
  const match = text.match(/set=pcb\.(\d+)/);
  return match ? match[1] : null;
}

function extractQuotedText(line) {
  const match = String(line || '').match(/"([^"]+)"/);
  return match ? match[1] : null;
}

function normalizeAuthorName(value) {
  return String(value || '').replace(/\s+Follow$/, '').trim();
}

function isNonPostHeading(value) {
  return /^(New posts|About|Recent media|Featured|Discussion|Members|Events|Media|Files)$/.test(String(value || '').trim());
}

function isNoiseText(value) {
  return /^(Facebook|Like|Comment|Send|View more comments|Play video|Play|Enter fullscreen|Unmute|Settings|Featured|New posts|Actions for this post|Shared with Private group)$/.test(String(value || '').trim());
}

function cleanupUrl(url) {
  return String(url || '').replace(/&amp;/g, '&');
}
