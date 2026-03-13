import { findExplicitBorough, findNeighborhood, inferBoroughFromNeighborhood } from './neighborhoods.js';

export function cleanPostBodyText(text) {
  return String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/…\s*See more/gi, '')
    .replace(/\bSee more\b/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function normalizeAuthorName(author, bodyText) {
  const value = String(author || '').replace(/\s*Follow\s*$/i, '').trim();
  if (!value) return null;
  const bodyStart = String(bodyText || '').trim().slice(0, 120);
  if (bodyStart && (value === bodyStart || bodyStart.startsWith(value))) return null;
  if (/^(About|Featured|Recent media|Discussion)$/i.test(value)) return null;
  if (/\$|apartment|sublet|room available|looking for|iso|bed\/|bath|penthouse/i.test(value)) return null;
  if (/^\+\d+$/.test(value)) return null;
  if (/^\d+:\d\d\s*\/\s*\d+:\d\d$/.test(value)) return null;
  if (/\.[a-z]{2,}$/i.test(value)) return null;
  if (/\d{3,}/.test(value)) return null;
  if (!/[A-Za-z]/.test(value)) return null;
  if (!/\s/.test(value)) return null;
  if (!/^[A-Za-zÀ-ÿ' .-]+$/.test(value)) return null;
  if (value.length < 4 || value.length > 50) return null;
  return value;
}

export function enrichPostLocation(post) {
  const text = cleanPostBodyText(post.bodyText || '');
  const neighborhood = findNeighborhood(text);
  const borough = neighborhood ? inferBoroughFromNeighborhood(neighborhood) : findExplicitBorough(text);
  return {
    ...post,
    bodyText: text,
    derivedLocation: {
      neighborhood: neighborhood || null,
      borough: borough || null,
    },
  };
}
