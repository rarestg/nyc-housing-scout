export const BOROUGHS = ['manhattan', 'brooklyn', 'queens', 'bronx', 'staten island'];

const NEIGHBORHOOD_DEFINITIONS = [
  { name: 'Williamsburg', borough: 'Brooklyn', patterns: [/\bwilliamsburg\b/i] },
  { name: 'East Williamsburg', borough: 'Brooklyn', patterns: [/\beast\s+williamsburg\b/i, /\be\.?\s*williamsburg\b/i] },
  { name: 'Bushwick', borough: 'Brooklyn', patterns: [/\bbushwick\b/i] },
  { name: 'Astoria', borough: 'Queens', patterns: [/\bastoria\b/i] },
  { name: 'Harlem', borough: 'Manhattan', patterns: [/\bharlem\b/i] },
  { name: 'Bed-Stuy', borough: 'Brooklyn', patterns: [/\bbed[\s-]?stuy\b/i, /\bbedford[\s-]?stuyvesant\b/i] },
  { name: 'Greenpoint', borough: 'Brooklyn', patterns: [/\bgreenpoint\b/i] },
  { name: 'North Greenpoint', borough: 'Brooklyn', patterns: [/\bnorth\s+greenpoint\b/i] },
  { name: 'Crown Heights', borough: 'Brooklyn', patterns: [/\bcrown\s+heights\b/i] },
  { name: 'Park Slope', borough: 'Brooklyn', patterns: [/\bpark\s+slope\b/i] },
  { name: 'Long Island City', borough: 'Queens', patterns: [/\blong\s+island\s+city\b/i] },
  { name: 'LIC', borough: 'Queens', patterns: [/\blic\b/i] },
  { name: 'Lower East Side', borough: 'Manhattan', patterns: [/\blower\s+east\s+side\b/i, /\bles\b/i] },
  { name: 'East Village', borough: 'Manhattan', patterns: [/\beast\s+village\b/i] },
  { name: 'West Village', borough: 'Manhattan', patterns: [/\bwest\s+village\b/i] },
  { name: 'Upper East Side', borough: 'Manhattan', patterns: [/\bupper\s+east\s+side\b/i, /\bues\b/i] },
  { name: 'Upper West Side', borough: 'Manhattan', patterns: [/\bupper\s+west\s+side\b/i, /\buws\b/i] },
];

export const NEIGHBORHOODS = NEIGHBORHOOD_DEFINITIONS.map((entry) => entry.name);

export function inferBoroughFromNeighborhood(neighborhood) {
  if (!neighborhood) return null;
  return NEIGHBORHOOD_DEFINITIONS.find((entry) => entry.name === neighborhood)?.borough ?? null;
}

export function findNeighborhood(text) {
  return findNeighborhoodMatches(text)[0]?.name ?? null;
}

export function findExplicitBorough(text) {
  return findExplicitBoroughMatches(text)[0]?.borough ?? null;
}

export function findNeighborhoodMatches(text) {
  const source = String(text || '');
  const matches = [];

  for (const definition of NEIGHBORHOOD_DEFINITIONS) {
    for (const pattern of definition.patterns) {
      for (const match of source.matchAll(toGlobalRegExp(pattern))) {
        const index = match.index ?? 0;
        matches.push({
          name: definition.name,
          borough: definition.borough,
          index,
          value: match[0],
          score: scoreLocationCandidate(source, index, match[0].length),
        });
      }
    }
  }

  return dedupeLocationMatches(matches, 'name');
}

export function findExplicitBoroughMatches(text) {
  const source = String(text || '');
  const matches = [];

  for (const borough of BOROUGHS) {
    const pattern = borough === 'staten island'
      ? /\bstaten\s+island\b/ig
      : new RegExp(`\\b${escapeRegExp(borough)}\\b`, 'ig');

    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (isStreetFalsePositive(source, index, match[0].length)) continue;

      const score = scoreLocationCandidate(source, index, match[0].length);
      if (score <= 0) continue;

      matches.push({
        borough: titleCase(borough),
        index,
        value: match[0],
        score,
      });
    }
  }

  return dedupeLocationMatches(matches, 'borough');
}

export function titleCase(value) {
  return value
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toGlobalRegExp(pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function scoreLocationCandidate(text, index, length) {
  const before = text.slice(Math.max(0, index - 28), index).toLowerCase();
  const after = text.slice(index + length, index + length + 40).toLowerCase();
  let score = 1 + Math.min(2, length / 10);

  if (/(?:^|[\s(\n,])(?:in|near|around|located in|located at|close to|off|at|from|preferably in)\s*$/.test(before)) {
    score += 4;
  }

  if (/(?:^|[\s(\n,])(?:on the border of|border of|between)\s*$/.test(before)) {
    score += 2;
  }

  if (/^\s*(?:apartment|apt|room|studio|unit|neighborhood|border|area|location|stop|bedroom|sublet|lease|move[- ]?in|available)\b/.test(after)) {
    score += 3;
  }

  if (/\b(?:commute|access|travel|work)\s+(?:into|to)\s*$/.test(before)) {
    score -= 3;
  }

  if (/\b(?:minutes?|stops?)\s+from\s*$/.test(before)) {
    score -= 4;
  }

  if (/\b(?:into|to)\s*$/.test(before)) {
    score -= 2;
  }

  if (/^\s+(?:ave|avenue|st|street|blvd|boulevard|bridge|tunnel|parkway)\b/.test(after)) {
    score -= 6;
  }

  return score;
}

function isStreetFalsePositive(text, index, length) {
  const after = text.slice(index + length, index + length + 18).toLowerCase();
  return /^\s+(?:ave|avenue|st|street|blvd|boulevard|bridge|tunnel|parkway)\b/.test(after);
}

function dedupeLocationMatches(matches, key) {
  const bestByKey = new Map();

  for (const match of matches) {
    const existing = bestByKey.get(match[key]);
    if (!existing || match.score > existing.score || (match.score === existing.score && match.index < existing.index)) {
      bestByKey.set(match[key], match);
    }
  }

  return Array.from(bestByKey.values()).sort((left, right) => right.score - left.score || right.value.length - left.value.length || left.index - right.index);
}
