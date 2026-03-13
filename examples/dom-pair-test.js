() => {
  const bodies = Array.from(document.querySelectorAll('[data-ad-rendering-role="story_message"]')).map((el, i) => ({
    i,
    text: (el.innerText || '').trim().slice(0, 1200),
  })).filter(x => x.text);

  const permalinks = Array.from(document.querySelectorAll('a[href*="/groups/"][href*="/posts/"]'))
    .filter((a) => !a.href.includes('comment_id='))
    .map((a, i) => ({
      i,
      href: a.href,
      text: (a.textContent || '').trim(),
      postId: (a.href.match(/posts\/(\d+)/) || [])[1] || null,
    }))
    .filter(x => x.postId);

  return {
    bodyCount: bodies.length,
    permalinkCount: permalinks.length,
    bodies: bodies.slice(0, 10),
    permalinks: permalinks.slice(0, 10),
  };
}
