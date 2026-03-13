export const DOM_EXTRACTOR_RUNTIME = () => {
  const BODY_SELECTOR = '[data-ad-rendering-role="story_message"]';
  const AUTHOR_SELECTOR = '[data-ad-rendering-role="profile_name"]';
  const CARD_SELECTOR = '[role="article"], article';
  const MAX_CARD_DEPTH = 16;
  const MONTH_PATTERN = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const WEEKDAY_PATTERN = 'Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?';
  const blocks = Array.from(document.querySelectorAll(BODY_SELECTOR));

  function readNodeText(node, options = {}) {
    if (!node) return '';
    const preserveLineBreaks = Boolean(options.preserveLineBreaks);
    const raw = node.innerText ?? node.textContent ?? '';
    const text = String(raw || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\r/g, '')
      .trim();

    if (!preserveLineBreaks) return text.replace(/\s+/g, ' ').trim();

    return text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeSpace(value) {
    return String(value || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitMetadataParts(value) {
    return String(value || '')
      .replace(/\u00A0/g, ' ')
      .split(/\n+/)
      .flatMap((part) => part.split(/\s*[|·•]\s*/))
      .map((part) => normalizeSpace(part))
      .filter(Boolean);
  }

  function parseUrl(href) {
    if (!href) return null;
    try {
      return new URL(href, location.href);
    } catch {
      return null;
    }
  }

  function readLabelledByText(node) {
    if (!node) return '';

    const labelledNode = node.getAttribute?.('aria-labelledby')
      ? node
      : node.querySelector?.('[aria-labelledby]');

    const labelIds = String(labelledNode?.getAttribute?.('aria-labelledby') || '')
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (!labelIds.length) return '';

    return normalizeSpace(labelIds
      .map((id) => document.getElementById(id))
      .map((labelNode) => readNodeText(labelNode))
      .filter(Boolean)
      .join(' '));
  }

  function decodeEncodedPostId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const decodedCandidates = [raw];

    try {
      const decodedURIComponentValue = decodeURIComponent(raw);
      if (decodedURIComponentValue && decodedURIComponentValue !== raw) {
        decodedCandidates.push(decodedURIComponentValue);
      }
    } catch {
      // Ignore malformed URL-encoded values.
    }

    for (const candidate of decodedCandidates) {
      const namespacedMatch = candidate.match(/(?:feedback|story|post|group_post):(\d{8,})/i);
      if (namespacedMatch) return namespacedMatch[1];

      if (/^\d{8,}$/.test(candidate)) return candidate;

      const multiPermalinkPart = candidate
        .split(',')
        .map((part) => part.trim())
        .find((part) => /^\d{8,}$/.test(part));

      if (multiPermalinkPart) return multiPermalinkPart;

      const normalizedBase64 = candidate.replace(/-/g, '+').replace(/_/g, '/');
      const paddedBase64 = normalizedBase64.padEnd(Math.ceil(normalizedBase64.length / 4) * 4, '=');

      try {
        const decoded = atob(paddedBase64);
        const feedbackMatch = decoded.match(/(?:feedback|story|post|group_post):(\d{8,})/i);
        if (feedbackMatch) return feedbackMatch[1];
        if (/^\d{8,}$/.test(decoded.trim())) return decoded.trim();
      } catch {
        // Ignore values that are not valid base64 payloads.
      }
    }

    return null;
  }

  function isArticleCard(node) {
    return Boolean(node && (
      (node.getAttribute && node.getAttribute('role') === 'article')
      || String(node.tagName || '').toUpperCase() === 'ARTICLE'
    ));
  }

  function uniqueElements(nodes) {
    const seen = new Set();
    const items = [];

    for (const node of nodes) {
      if (!node || seen.has(node)) continue;
      seen.add(node);
      items.push(node);
    }

    return items;
  }

  function collectNodesFromRoots(roots, selector) {
    const nodes = [];

    for (const root of roots) {
      if (!root || !root.querySelectorAll) continue;
      if (root.matches && root.matches(selector)) nodes.push(root);
      nodes.push(...root.querySelectorAll(selector));
    }

    return uniqueElements(nodes);
  }

  function buildHeaderSearchRoots(card, bodyEl) {
    const roots = [];
    const allowTopLevelSiblings = isArticleCard(card);
    let current = bodyEl;

    while (current && current !== card) {
      if (current.parentElement) {
        const parentIsCard = current.parentElement === card;
        if (!parentIsCard || allowTopLevelSiblings) {
          let sibling = current.previousElementSibling;
          let siblingCount = 0;
          while (sibling && siblingCount < 4) {
            roots.push(sibling);
            sibling = sibling.previousElementSibling;
            siblingCount += 1;
          }
        }
      }
      current = current.parentElement;
    }

    return uniqueElements(roots);
  }

  function buildCardTopSliceRoots(card, bodyEl) {
    const roots = [];
    let current = bodyEl;

    while (current && current !== card) {
      const parent = current.parentElement;
      if (!parent) break;

      const siblings = Array.from(parent.children || []);
      const bodyIndex = siblings.indexOf(current);
      if (bodyIndex > 0) {
        roots.push(...siblings.slice(0, Math.min(bodyIndex, 3)));
      }

      current = parent;
    }

    if (card && card.children && card.children.length) {
      roots.push(...Array.from(card.children).slice(0, 3));
    }

    return uniqueElements(roots.filter((node) => node && node !== bodyEl));
  }

  function buildDebugHeaderSnapshot(card, bodyEl, headerRoots) {
    const roots = headerRoots && headerRoots.length ? headerRoots : buildHeaderSearchRoots(card, bodyEl);
    return roots.slice(0, 4).map((node, index) => ({
      index,
      tagName: String(node?.tagName || '').toUpperCase() || null,
      text: readNodeText(node).slice(0, 240) || null,
      html: String(node?.outerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 700) || null,
    }));
  }

  function looksHumanName(value) {
    const v = normalizeSpace(value);
    if (!v) return false;
    if (v.length < 3 || v.length > 60) return false;
    if (/^(Just now|Yesterday|See more|Like|Comment|Send|Share|Message|Follow|\+\d+|\d+:\d\d)/i.test(v)) return false;
    if (/\$|apartment|sublet|room available|looking for|iso|bed\/|bath|penthouse|furnished|unfurnished|available now|lease takeover|luxury/i.test(v)) return false;
    if (/\d{3,}/.test(v)) return false;
    return /[A-Za-z]/.test(v) && /^[A-Za-zÀ-ÿ' .-]+$/.test(v);
  }

  function extractAuthorText(value, bodyText) {
    const bodyStart = normalizeSpace(bodyText).slice(0, 120);

    for (const part of splitMetadataParts(value)) {
      if (!looksHumanName(part)) continue;
      if (bodyStart && (part === bodyStart || bodyStart.startsWith(part))) continue;
      if (/\.[a-z]{2,}$/i.test(part)) continue;
      return part;
    }

    return null;
  }

  function isAuthorProfileHref(href) {
    const url = parseUrl(href);
    if (!url) return false;
    const pathname = url.pathname || '';

    if (extractPostIdFromUrl(url)) return false;
    if (/\/groups\//i.test(pathname)) return false;
    if (/\/photo\/|\/videos?\//i.test(pathname)) return false;
    if (/\/events\//i.test(pathname)) return false;
    if (/\/marketplace\//i.test(pathname)) return false;
    if (/\/watch\//i.test(pathname)) return false;
    if (/\/search\//i.test(pathname)) return false;

    return true;
  }

  function sortScoredValues(candidates) {
    const bestByValue = new Map();

    for (const candidate of candidates) {
      if (!candidate || !candidate.value) continue;
      const existing = bestByValue.get(candidate.value);
      if (!existing || candidate.score > existing.score) {
        bestByValue.set(candidate.value, candidate);
      }
    }

    return Array.from(bestByValue.values()).sort((a, b) => b.score - a.score || a.order - b.order || a.value.length - b.value.length);
  }

  function toDebugCandidates(candidates, limit = 8) {
    return sortScoredValues(candidates)
      .slice(0, limit)
      .map((candidate) => ({
        value: candidate.value,
        score: candidate.score,
        from: candidate.from || null,
        href: candidate.href || null,
        tagName: candidate.tagName || null,
      }));
  }

  function findAuthor(card, bodyEl) {
    const bodyText = readNodeText(bodyEl, { preserveLineBreaks: true });
    const headerRoots = buildHeaderSearchRoots(card, bodyEl);
    const headerNodes = collectNodesFromRoots(headerRoots, `${AUTHOR_SELECTOR}, a[href], h1, h2, h3, h4, strong`);
    const fallbackNodes = collectNodesFromRoots([card], `${AUTHOR_SELECTOR}, a[href], h1, h2, h3, h4, strong`);
    const candidates = [];

    function addAuthorCandidates(nodes, baseScore) {
      nodes.forEach((node, index) => {
        const value = extractAuthorText(readNodeText(node), bodyText);
        if (!value) return;

        let score = baseScore - index;
        if (node.matches && node.matches(AUTHOR_SELECTOR)) score += 80;
        if (/^H[1-4]$/.test(String(node.tagName || '').toUpperCase())) score += 20;
        if (String(node.tagName || '').toUpperCase() === 'A') score += 12;
        if (isAuthorProfileHref(node.href || (node.getAttribute && node.getAttribute('href')))) score += 18;

        candidates.push({
          value,
          score,
          order: index,
          from: 'author',
          href: node.href || (node.getAttribute && node.getAttribute('href')) || null,
          tagName: String(node.tagName || '').toUpperCase() || null,
        });
      });
    }

    addAuthorCandidates(headerNodes, 40);
    addAuthorCandidates(fallbackNodes, 0);

    const ranked = sortScoredValues(candidates);
    return {
      value: ranked[0]?.value || null,
      debug: toDebugCandidates(candidates),
    };
  }

  function extractTimeText(value) {
    const normalized = normalizeSpace(value);
    if (!normalized) return null;

    const parts = splitMetadataParts(normalized);
    for (const part of parts) {
      if (looksLikeTimeText(part)) return part;
    }

    if (looksLikeTimeText(normalized)) return normalized;
    return null;
  }

  function looksLikeTimeText(value) {
    const text = normalizeSpace(value);
    if (!text) return false;
    if (/^May be\b/i.test(text)) return false;
    if (/^\d+\s+remaining items?$/i.test(text)) return false;
    if (/^Shared with\b/i.test(text)) return false;
    if (/^(Just now|Yesterday|Today|Now)$/i.test(text)) return true;
    if (/^\d+\s*(?:m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?|w|wk|wks|weeks?)$/i.test(text)) return true;
    if (/^\d+\s*(?:m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?|w|wk|wks|weeks?|mo|mos|months?|yr|yrs|years?)\s+ago$/i.test(text)) return true;
    if (/^\d+[mhdw]$/i.test(text)) return true;
    if (new RegExp(`^(?:${MONTH_PATTERN}|${WEEKDAY_PATTERN})\\b.*\\d`, 'i').test(text)) return true;
    if (/^(?:Yesterday|Today)\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(text)) return true;
    return /^\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(text);
  }

  function findTime(card, bodyEl) {
    const headerRoots = buildHeaderSearchRoots(card, bodyEl);
    const topSliceRoots = buildCardTopSliceRoots(card, bodyEl);
    const headerNodes = collectNodesFromRoots(headerRoots, 'a[href], time, abbr[title], [aria-label], [title]');
    const topSliceNodes = collectNodesFromRoots(topSliceRoots, 'a[href], time, abbr[title], [aria-label], [title]');
    const fallbackNodes = collectNodesFromRoots([card], 'a[href], time, abbr[title], [aria-label], [title]');
    const candidates = [];

    function addTimeCandidates(nodes, baseScore) {
      nodes.forEach((node, index) => {
        const sources = [
          { value: readNodeText(node), score: 0 },
          { value: readLabelledByText(node), score: 10 },
          { value: node.getAttribute && node.getAttribute('aria-label'), score: 8 },
          { value: node.getAttribute && node.getAttribute('title'), score: 6 },
        ];

        sources.forEach((source, sourceIndex) => {
          const value = extractTimeText(source.value);
          if (!value) return;

          let score = baseScore - index - sourceIndex + source.score;
          if (String(node.tagName || '').toUpperCase() === 'A') score += 12;
          if (normalizePostUrl(node.href || (node.getAttribute && node.getAttribute('href')))) score += 16;
          if (new RegExp(`^(?:${MONTH_PATTERN}|${WEEKDAY_PATTERN})\\b`, 'i').test(value)) score += 6;

          candidates.push({
            value,
            score,
            order: (index * 4) + sourceIndex,
            from: sourceIndex === 0
              ? 'text'
              : (sourceIndex === 1 ? 'labelledby' : (sourceIndex === 2 ? 'aria-label' : 'title')),
            href: node.href || (node.getAttribute && node.getAttribute('href')) || null,
            tagName: String(node.tagName || '').toUpperCase() || null,
          });
        });
      });
    }

    addTimeCandidates(headerNodes, 30);
    addTimeCandidates(topSliceNodes, 18);
    addTimeCandidates(fallbackNodes, 0);

    const ranked = sortScoredValues(candidates);
    return {
      value: ranked[0]?.value || null,
      debug: toDebugCandidates(candidates),
    };
  }

  function extractPostIdFromUrl(input) {
    const value = typeof input === 'string' ? input : input?.toString?.();
    if (!value) return null;

    const embeddedPostId = value.match(/set=(?:pcb|gm)\.(\d+)/i)?.[1]
      || value.match(/\/videos?\/pcb\.(\d+)/i)?.[1]
      || value.match(/posts\/(\d+)/i)?.[1]
      || null;

    const url = typeof input === 'string' ? parseUrl(input) : input;
    if (url) {
      const pathname = url.pathname || '';
      const pathMatch = pathname.match(/\/posts\/(\d+)/i);
      if (pathMatch) return pathMatch[1];
      if (/\/photo\/|\/videos?\//i.test(pathname) && embeddedPostId) return embeddedPostId;

      const storyFbid = decodeEncodedPostId(url.searchParams.get('story_fbid'))
        || decodeEncodedPostId(url.searchParams.get('fbid'))
        || decodeEncodedPostId(url.searchParams.get('post_id'))
        || decodeEncodedPostId(url.searchParams.get('multi_permalinks'))
        || decodeEncodedPostId(url.searchParams.get('ft_ent_identifier'));
      if (storyFbid) return storyFbid;
    }

    return embeddedPostId;
  }

  function buildContextGroupPostUrl(postId) {
    if (!postId) return null;
    const groupMatch = (location.pathname || '').match(/\/groups\/([^/]+)/i);
    if (!groupMatch) return null;
    return `${location.origin}/groups/${groupMatch[1]}/posts/${postId}/`;
  }

  function normalizePostUrl(href) {
    const url = parseUrl(href);
    if (!url) return null;

    const postId = extractPostIdFromUrl(url);
    if (!postId) return null;

    url.hash = '';

    if (/\/photo\/|\/videos?\//i.test(url.pathname || '')) return null;
    if (/\/avatar\/edit\//i.test(url.pathname || '')) return null;

    const pathname = url.pathname || '';
    const groupPostMatch = pathname.match(/(\/groups\/[^/]+\/posts\/\d+\/?)/i);
    if (groupPostMatch) return `${url.origin}${groupPostMatch[1]}`;

    const genericPostMatch = pathname.match(/(\/[^/]+\/posts\/\d+\/?)/i);
    if (genericPostMatch) return `${url.origin}${genericPostMatch[1]}`;

    if (/\/(?:story|permalink)\.php$/i.test(pathname)) {
      const normalized = new URL(`${url.origin}${pathname}`);
      const storyFbid = url.searchParams.get('story_fbid') || url.searchParams.get('fbid');
      const ownerId = url.searchParams.get('id');

      if (storyFbid) normalized.searchParams.set('story_fbid', storyFbid);
      if (ownerId) normalized.searchParams.set('id', ownerId);

      return normalized.toString();
    }

    return `${url.origin}${pathname}${url.search}`;
  }

  function findPermalink(card, bodyEl) {
    const headerRoots = buildHeaderSearchRoots(card, bodyEl);
    const headerNodes = collectNodesFromRoots(headerRoots, 'a[href]');
    const fallbackNodes = collectNodesFromRoots([card], 'a[href]');
    const candidates = [];

    function addPermalinkCandidates(nodes, baseScore) {
      nodes.forEach((node, index) => {
        const href = node.href || (node.getAttribute && node.getAttribute('href'));
        const value = normalizePostUrl(href);
        if (!value) return;

        let score = baseScore - index;
        if (/\/groups\/[^/]+\/posts\/\d+/i.test(value)) score += 70;
        else if (/\/(?:story|permalink)\.php/i.test(value)) score += 55;
        else if (/\/posts\/\d+/i.test(value)) score += 45;
        if (extractPostIdFromUrl(value)) score += 20;
        if (extractTimeText(readNodeText(node))) score += 10;
        if (extractTimeText(node.getAttribute && node.getAttribute('aria-label'))) score += 8;
        if (/comment_id=/i.test(String(href || ''))) score -= 2;

        candidates.push({
          value,
          score,
          order: index,
          from: 'permalink',
          href: href || null,
          tagName: String(node.tagName || '').toUpperCase() || null,
        });
      });
    }

    addPermalinkCandidates(headerNodes, 30);
    addPermalinkCandidates(fallbackNodes, 0);

    const ranked = sortScoredValues(candidates);
    const best = ranked[0]?.value || null;
    if (best) {
      return {
        value: best,
        debug: toDebugCandidates(candidates),
      };
    }

    const mediaPostId = Array.from(card.querySelectorAll('a[href]'))
      .map((node) => extractPostIdFromUrl(node.href || (node.getAttribute && node.getAttribute('href'))))
      .find(Boolean);

    return {
      value: buildContextGroupPostUrl(mediaPostId),
      debug: toDebugCandidates(candidates),
    };
  }

  function scoreCard(node, bodyEl, depth) {
    if (!node || !node.querySelectorAll) return Number.NEGATIVE_INFINITY;

    const storyCount = node.querySelectorAll(BODY_SELECTOR).length;
    if (!storyCount) return Number.NEGATIVE_INFINITY;

    let score = 0;

    if (storyCount === 1) score += 60;
    else score -= (storyCount - 1) * 35;

    if (isArticleCard(node)) score += 30;

    const anchorCount = node.querySelectorAll('a[href]').length;
    if (anchorCount >= 1 && anchorCount <= 24) score += 8;
    if (anchorCount > 40) score -= 12;

    const headerRoots = buildHeaderSearchRoots(node, bodyEl);
    const authorResult = findAuthor(node, bodyEl);
    const timeResult = findTime(node, bodyEl);
    const permalinkResult = findPermalink(node, bodyEl);

    if (headerRoots.length) score += 4;
    if (authorResult.value) score += 18;
    if (timeResult.value) score += 16;
    if (permalinkResult.value) score += 24;

    score -= depth * 4;

    return score;
  }

  function closestCard(el) {
    let node = el;
    let depth = 0;
    const candidates = [];

    while (node && depth < MAX_CARD_DEPTH) {
      candidates.push({
        node,
        depth,
        score: scoreCard(node, el, depth),
      });
      node = node.parentElement;
      depth += 1;
    }

    candidates.sort((a, b) => b.score - a.score || a.depth - b.depth);
    return candidates[0]?.node || el.closest?.(CARD_SELECTOR) || el.parentElement || el;
  }

  return blocks.map((bodyEl, index) => {
    const card = closestCard(bodyEl);
    const allAnchors = Array.from(card.querySelectorAll('a[href]'));
    const headerRoots = buildHeaderSearchRoots(card, bodyEl);
    const authorResult = findAuthor(card, bodyEl);
    const timeResult = findTime(card, bodyEl);
    const permalinkResult = findPermalink(card, bodyEl);
    const postUrl = permalinkResult.value;
    const mediaLinks = allAnchors
      .map((a) => a.href)
      .filter((href) => /\/photo\/\?fbid=|\/videos?\//i.test(href));
    const mediaMatch = mediaLinks.join('\n').match(/set=(?:pcb|gm)\.(\d+)/);
    const postId = extractPostIdFromUrl(postUrl) || (mediaMatch && mediaMatch[1]) || null;
    const seeMoreButton = Array.from(card.querySelectorAll('div[role="button"], button')).find((btn) => /See more/i.test(readNodeText(btn)));

    return {
      index,
      postId,
      author: authorResult.value,
      postUrl,
      postedAtText: timeResult.value,
      bodyText: readNodeText(bodyEl, { preserveLineBreaks: true }),
      mediaLinks: Array.from(new Set(mediaLinks)).slice(0, 12),
      hasSeeMore: Boolean(seeMoreButton),
      seeMoreText: seeMoreButton ? readNodeText(seeMoreButton) : null,
      debugMetadata: {
        authorCandidates: authorResult.debug,
        timeCandidates: timeResult.debug,
        permalinkCandidates: permalinkResult.debug,
        headerSnapshot: buildDebugHeaderSnapshot(card, bodyEl, headerRoots),
      },
    };
  }).filter((record) => record.bodyText);
};

export const DOM_EXTRACTOR_FN = DOM_EXTRACTOR_RUNTIME.toString();
