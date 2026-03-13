() => {
  const permalinkAnchors = Array.from(document.querySelectorAll('a[href*="/groups/"][href*="/posts/"]'))
    .filter((a) => !a.href.includes('comment_id='));

  const seen = new Set();
  const records = [];

  for (const a of permalinkAnchors) {
    const href = a.href;
    const postIdMatch = href.match(/posts\/(\d+)/);
    const postId = postIdMatch ? postIdMatch[1] : null;
    if (!postId || seen.has(postId)) continue;
    seen.add(postId);

    const article = a.closest('[role="article"]') || a.closest('div[role="feed"] > div') || a.closest('div');
    const block = article || a.parentElement;
    const text = (block?.innerText || '').trim();
    const media = Array.from(block?.querySelectorAll('a[href*="/photo/"]') || []).map((x) => x.href);
    const author = (() => {
      const h = block?.querySelector('h2, h3');
      return (h?.innerText || '').trim();
    })();

    records.push({
      postId,
      href,
      author,
      text: text.slice(0, 2000),
      media: media.slice(0, 10),
    });
  }

  return { count: records.length, records: records.slice(0, 20) };
}
