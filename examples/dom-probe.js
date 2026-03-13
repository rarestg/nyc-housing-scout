() => {
  const a = Array.from(document.querySelectorAll('a[href*="/groups/"][href*="/posts/"]')).find(x => x.href.includes('/posts/24492404357124136/'));
  if (!a) return { found: false };
  const chain = [];
  let el = a;
  for (let i = 0; i < 8 && el; i += 1) {
    chain.push({
      tag: el.tagName,
      role: el.getAttribute('role'),
      cls: el.className,
      text: (el.innerText || '').slice(0, 400),
      childCount: el.children.length,
    });
    el = el.parentElement;
  }
  return { found: true, chain };
}
