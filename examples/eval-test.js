() => {
  const links = Array.from(document.querySelectorAll('a[href*="/posts/"]'));
  const posts = links.slice(0, 20).map((a) => ({
    text: (a.textContent || '').trim(),
    href: a.href,
  }));
  return { count: links.length, posts };
}
