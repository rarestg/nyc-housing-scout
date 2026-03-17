function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function getNormalizedFacebookOrigin(parsedUrl) {
  return `https://${parsedUrl.hostname.replace(/^m\./i, 'www.')}`;
}

function buildCanonicalGroupPostUrl(origin, groupRef, postId) {
  if (!origin || !groupRef || !postId) return null;
  return `${origin}/groups/${groupRef}/posts/${postId}/`;
}

function getGroupsPostMatch(pathname) {
  return pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d{8,})\/?$/i);
}

function getGroupRootRef(pathname) {
  return pathname.match(/^\/groups\/([^/]+)\/?$/i)?.[1] || null;
}

function getPostIdFromParsedUrl(parsedUrl, explicitPostId) {
  return normalizeNullableString(explicitPostId)
    || normalizeNullableString(parsedUrl.searchParams.get('story_fbid'))
    || normalizeNullableString(parsedUrl.searchParams.get('multi_permalinks'));
}

function isCanonicalGroupPostUrl(url) {
  return /\/groups\/[^/]+\/posts\/\d{8,}\//i.test(String(url || ''));
}

export function normalizeFacebookPostUrl(url, { postId, groupId } = {}) {
  const raw = normalizeNullableString(url);
  if (!raw) return null;

  try {
    const parsed = new URL(raw, 'https://www.facebook.com');
    const normalizedOrigin = getNormalizedFacebookOrigin(parsed);
    const normalizedPostId = getPostIdFromParsedUrl(parsed, postId);
    const normalizedGroupId = normalizeNullableString(parsed.searchParams.get('id'))
      || normalizeNullableString(groupId);
    const pathname = parsed.pathname || '';
    const groupsMatch = getGroupsPostMatch(pathname);

    if (groupsMatch) {
      return buildCanonicalGroupPostUrl(
        normalizedOrigin,
        normalizedGroupId || groupsMatch[1],
        groupsMatch[2],
      );
    }

    if (/^\/(?:story|permalink)\.php$/i.test(pathname) && normalizedPostId && normalizedGroupId) {
      return buildCanonicalGroupPostUrl(normalizedOrigin, normalizedGroupId, normalizedPostId);
    }

    const groupRootRef = getGroupRootRef(pathname);
    const multiPermalinks = normalizeNullableString(parsed.searchParams.get('multi_permalinks'));
    if (groupRootRef && multiPermalinks) {
      return buildCanonicalGroupPostUrl(normalizedOrigin, groupRootRef, multiPermalinks);
    }

    const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
    return `${normalizedOrigin}${normalizedPath}`;
  } catch {
    return raw;
  }
}

export function extractFacebookPostIdFromUrl(url) {
  const raw = normalizeNullableString(url);
  if (!raw) return null;

  try {
    const parsed = new URL(raw, 'https://www.facebook.com');
    const pathname = parsed.pathname || '';
    const groupsMatch = getGroupsPostMatch(pathname);
    if (groupsMatch?.[2]) {
      return groupsMatch[2];
    }

    return getPostIdFromParsedUrl(parsed, null);
  } catch {
    const groupsMatch = raw.match(/\/groups\/[^/]+\/(?:posts|permalink)\/(\d{8,})\/?/i);
    if (groupsMatch?.[1]) {
      return groupsMatch[1];
    }
    return null;
  }
}

export function buildFacebookFallbackPostUrl(postId, { groupId, groupUrl } = {}) {
  const normalizedPostId = normalizeNullableString(postId);
  if (!normalizedPostId) return null;

  const normalizedGroupId = normalizeNullableString(groupId);
  const rawGroupUrl = normalizeNullableString(groupUrl);

  if (rawGroupUrl) {
    const normalizedGroupUrl = normalizeFacebookPostUrl(rawGroupUrl, {
      postId: normalizedPostId,
      groupId: normalizedGroupId,
    });
    if (normalizedGroupUrl && isCanonicalGroupPostUrl(normalizedGroupUrl)) {
      return normalizedGroupUrl;
    }

    try {
      const parsed = new URL(rawGroupUrl, 'https://www.facebook.com');
      const normalizedOrigin = getNormalizedFacebookOrigin(parsed);
      const groupRootRef = getGroupRootRef(parsed.pathname || '');

      if (normalizedGroupId || groupRootRef) {
        return buildCanonicalGroupPostUrl(
          normalizedOrigin,
          normalizedGroupId || groupRootRef,
          normalizedPostId,
        );
      }
    } catch {
      // Fall back to the explicit groupId path below.
    }
  }

  if (!normalizedGroupId) return null;
  return buildCanonicalGroupPostUrl('https://www.facebook.com', normalizedGroupId, normalizedPostId);
}
