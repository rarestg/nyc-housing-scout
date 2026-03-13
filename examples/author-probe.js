() => {
  const blocks = Array.from(document.querySelectorAll('[data-ad-rendering-role="story_message"]')).slice(0, 6);
  return blocks.map((bodyEl, index) => {
    let node = bodyEl;
    for (let i = 0; i < 16 && node; i += 1) {
      const hasStory = node.querySelector && node.querySelector('[data-ad-rendering-role="story_message"]');
      const links = node.querySelectorAll ? Array.from(node.querySelectorAll('a[href]')).map(a => ({text:(a.innerText||'').trim(), href:a.href})).filter(x => x.text) : [];
      if (hasStory && links.length >= 3) {
        return {
          index,
          body: (bodyEl.innerText || '').slice(0, 180),
          headingTexts: Array.from(node.querySelectorAll('h2,h3')).map(h => (h.innerText||'').trim()).filter(Boolean),
          linkTexts: links.slice(0, 20),
        };
      }
      node = node.parentElement;
    }
    return { index, body: (bodyEl.innerText || '').slice(0, 180), headingTexts: [], linkTexts: [] };
  });
}
