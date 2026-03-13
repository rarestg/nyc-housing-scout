export const DOM_EXPAND_VISIBLE_FN = String.raw`() => {
  const clicked = [];
  const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
  for (const btn of buttons) {
    const text = (btn.innerText || btn.textContent || '').trim();
    if (!/^(See more|See More)$/i.test(text)) continue;
    const rect = btn.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
    if (!visible) continue;
    try {
      btn.click();
      clicked.push({ text, top: Math.round(rect.top) });
    } catch {}
  }
  return { clickedCount: clicked.length, clicked };
}`;

export const DOM_SCROLL_PAGE_FN = String.raw`(distance = 1200) => {
  const before = window.scrollY;
  window.scrollBy(0, distance);
  return {
    before,
    after: window.scrollY,
    bodyHeight: document.body.scrollHeight,
    viewport: window.innerHeight,
  };
}`;

export const DOM_PAGE_STATE_FN = String.raw`() => ({
  href: location.href,
  title: document.title,
  scrollY: window.scrollY,
  bodyHeight: document.body.scrollHeight,
  viewport: window.innerHeight,
})`;
