import { inferBoroughFromNeighborhood } from './neighborhoods.js';

export const ADDRESS_RESOLUTION_KIND = 'address_resolution';
export const ADDRESS_RESOLVER_VERSION = 'nyc-address-resolver-v1';
export const ADDRESS_RESOLVED_FIELD_PATHS = [
  'location.address',
  'location.neighborhood',
  'location.borough',
  'location.city',
  'location.state',
];

const NYC_CITY = 'New York';
const NYC_STATE = 'NY';
const ACCEPTED_BOROUGH_CONFIDENCE = 0.68;
const ACCEPTED_NEIGHBORHOOD_CONFIDENCE = 0.7;
const ACCEPTED_ADDRESS_CONFIDENCE = 0.8;
const MATERIAL_COMPETITION_GAP = 0.12;
const MATERIAL_COMPETITION_RATIO = 0.86;
const STREET_SUFFIXES = new Map([
  ['street', 'St'],
  ['st', 'St'],
  ['avenue', 'Ave'],
  ['ave', 'Ave'],
  ['road', 'Rd'],
  ['rd', 'Rd'],
  ['boulevard', 'Blvd'],
  ['blvd', 'Blvd'],
  ['lane', 'Ln'],
  ['ln', 'Ln'],
  ['drive', 'Dr'],
  ['dr', 'Dr'],
  ['court', 'Ct'],
  ['ct', 'Ct'],
  ['place', 'Pl'],
  ['pl', 'Pl'],
  ['way', 'Way'],
  ['terrace', 'Ter'],
  ['ter', 'Ter'],
  ['parkway', 'Pkwy'],
  ['pkwy', 'Pkwy'],
]);
const DIRECTIONALS = new Map([
  ['north', 'N'],
  ['south', 'S'],
  ['east', 'E'],
  ['west', 'W'],
  ['n', 'N'],
  ['s', 'S'],
  ['e', 'E'],
  ['w', 'W'],
]);
const UNIT_MARKERS = new Map([
  ['apt', 'Apt'],
  ['apartment', 'Apt'],
  ['unit', 'Unit'],
  ['floor', 'Fl'],
  ['fl', 'Fl'],
]);

export function buildListingAddressResolutions(listing, fragments, options = {}) {
  const allFragments = Array.isArray(fragments) ? fragments : [];
  const resolutionKind = normalizeString(options.resolutionKind) || ADDRESS_RESOLUTION_KIND;
  const resolverVersion = normalizeString(options.resolverVersion) || ADDRESS_RESOLVER_VERSION;
  const locationFragments = allFragments.filter(isLocationFragment);
  const context = buildLocationContext(locationFragments, { allFragmentCount: allFragments.length });
  const boroughState = buildBoroughResolution(context);
  const neighborhoodState = buildNeighborhoodResolution(context, { boroughState });
  const addressState = buildAddressResolution(context, { boroughState, neighborhoodState });
  const cityState = buildCityResolution(context, { boroughState, neighborhoodState, addressState });
  const stateState = buildStateResolution(context, { boroughState, neighborhoodState, addressState });

  return [
    buildResolvedFieldInput('location.address', addressState, listing, context, { resolutionKind, resolverVersion }),
    buildResolvedFieldInput('location.neighborhood', neighborhoodState, listing, context, { resolutionKind, resolverVersion }),
    buildResolvedFieldInput('location.borough', boroughState, listing, context, { resolutionKind, resolverVersion }),
    buildResolvedFieldInput('location.city', cityState, listing, context, { resolutionKind, resolverVersion }),
    buildResolvedFieldInput('location.state', stateState, listing, context, { resolutionKind, resolverVersion }),
  ];
}

function buildBoroughResolution(context) {
  if (!context.hasLocationEvidence) {
    return buildFieldState({
      status: 'unresolved',
      reason: context.allFragmentCount ? 'no_location_evidence_fragments' : 'missing_evidence_fragments',
    });
  }

  const candidates = context.boroughCandidates;
  if (!candidates.length) {
    return buildFieldState({
      status: 'unresolved',
      reason: 'no_borough_or_neighborhood_candidates',
    });
  }

  const top = candidates[0];
  const second = candidates[1] || null;
  const topConfidence = computeCandidateConfidence(top);
  const ambiguous = hasMaterialCompetition(top, second);

  if (ambiguous) {
    return buildFieldState({
      status: 'ambiguous',
      value: null,
      confidence: topConfidence,
      reason: 'conflicting_borough_candidates',
      candidates,
      supportingFragmentIds: collectCandidateSupportIds(candidates),
    });
  }

  const status = topConfidence >= ACCEPTED_BOROUGH_CONFIDENCE ? 'accepted' : 'candidate';
  return buildFieldState({
    status,
    value: top.value,
    confidence: topConfidence,
    reason: status === 'accepted' ? 'borough_supported_by_location_fragments' : 'borough_below_acceptance_threshold',
    candidates,
    supportingFragmentIds: top.fragmentIds,
    metadata: {
      inferredFromNeighborhoodCount: top.inferredFromNeighborhoodCount,
    },
  });
}

function buildNeighborhoodResolution(context, input) {
  if (!context.hasLocationEvidence) {
    return buildFieldState({
      status: 'unresolved',
      reason: context.allFragmentCount ? 'no_location_evidence_fragments' : 'missing_evidence_fragments',
    });
  }

  const preferredBorough = input?.boroughState?.status === 'accepted'
    ? normalizeString(input.boroughState.value)
    : null;
  const filteredCandidates = preferredBorough
    ? context.neighborhoodCandidates.filter((candidate) => !candidate.borough || candidate.borough === preferredBorough)
    : context.neighborhoodCandidates;
  const candidates = filteredCandidates.length ? filteredCandidates : context.neighborhoodCandidates;

  if (!candidates.length) {
    return buildFieldState({
      status: 'unresolved',
      reason: 'no_neighborhood_candidates',
    });
  }

  const top = candidates[0];
  const second = candidates[1] || null;
  const topConfidence = computeCandidateConfidence(top);
  const competingCrossBorough = Boolean(preferredBorough)
    && context.neighborhoodCandidates.some((candidate) => candidate.borough && candidate.borough !== preferredBorough && computeCandidateConfidence(candidate) >= 0.56);
  const ambiguous = competingCrossBorough || hasMaterialCompetition(top, second);

  if (ambiguous) {
    return buildFieldState({
      status: 'ambiguous',
      value: null,
      confidence: topConfidence,
      reason: competingCrossBorough ? 'neighborhood_conflicts_with_resolved_borough' : 'multiple_neighborhood_candidates',
      candidates: context.neighborhoodCandidates,
      supportingFragmentIds: collectCandidateSupportIds(context.neighborhoodCandidates),
    });
  }

  const status = topConfidence >= ACCEPTED_NEIGHBORHOOD_CONFIDENCE ? 'accepted' : 'candidate';
  return buildFieldState({
    status,
    value: top.value,
    confidence: topConfidence,
    reason: status === 'accepted' ? 'neighborhood_supported_by_location_fragments' : 'neighborhood_below_acceptance_threshold',
    candidates,
    supportingFragmentIds: top.fragmentIds,
    metadata: compactObject({
      borough: top.borough,
    }),
  });
}

function buildAddressResolution(context, input) {
  if (!context.hasLocationEvidence) {
    return buildFieldState({
      status: 'unresolved',
      reason: context.allFragmentCount ? 'no_location_evidence_fragments' : 'missing_evidence_fragments',
    });
  }

  if (!context.addressCandidates.length) {
    return buildFieldState({
      status: 'unresolved',
      reason: 'no_address_candidates',
    });
  }

  const top = context.addressCandidates[0];
  const second = context.addressCandidates[1] || null;
  const locationSupport = buildAddressLocationSupport(input);
  const topConfidence = clamp(
    computeCandidateConfidence(top)
      + locationSupport.confidenceBonus
      + (top.candidateType === 'street_address' ? 0.1 : 0.05),
    0,
    0.97,
  );
  const ambiguous = hasMaterialCompetition(top, second);
  const formattedValue = formatResolvedAddress(top.value, {
    neighborhood: input?.neighborhoodState?.status === 'accepted' ? input.neighborhoodState.value : null,
    borough: input?.boroughState?.status === 'accepted' ? input.boroughState.value : null,
    city: locationSupport.hasAcceptedLocation ? NYC_CITY : null,
    state: locationSupport.hasAcceptedLocation ? NYC_STATE : null,
  });

  if (ambiguous) {
    return buildFieldState({
      status: 'ambiguous',
      value: null,
      confidence: topConfidence,
      reason: 'multiple_address_candidates',
      candidates: context.addressCandidates,
      supportingFragmentIds: uniqueStrings([
        ...collectCandidateSupportIds(context.addressCandidates),
        ...locationSupport.supportingFragmentIds,
      ]),
    });
  }

  if (locationSupport.hasAcceptedLocation && topConfidence >= ACCEPTED_ADDRESS_CONFIDENCE) {
    return buildFieldState({
      status: 'accepted',
      value: formattedValue,
      confidence: topConfidence,
      reason: 'address_supported_by_nyc_location_fragments',
      candidates: context.addressCandidates,
      supportingFragmentIds: uniqueStrings([
        ...top.fragmentIds,
        ...locationSupport.supportingFragmentIds,
      ]),
      metadata: {
        candidateType: top.candidateType,
      },
    });
  }

  return buildFieldState({
    status: 'candidate',
    value: top.value,
    confidence: topConfidence,
    reason: locationSupport.hasAnyLocationSupport
      ? 'address_below_acceptance_threshold'
      : 'missing_borough_or_neighborhood_support',
    candidates: context.addressCandidates,
    supportingFragmentIds: uniqueStrings([
      ...top.fragmentIds,
      ...locationSupport.supportingFragmentIds,
    ]),
    metadata: {
      candidateType: top.candidateType,
    },
  });
}

function buildCityResolution(context, input) {
  if (!context.hasLocationEvidence) {
    return buildFieldState({
      status: 'unresolved',
      reason: context.allFragmentCount ? 'no_location_evidence_fragments' : 'missing_evidence_fragments',
    });
  }

  const nycSupportIds = collectNycSupportIds(context, input);
  if (!nycSupportIds.length) {
    return buildFieldState({
      status: 'unresolved',
      reason: 'no_nyc_location_support',
    });
  }

  return buildFieldState({
    status: 'accepted',
    value: NYC_CITY,
    confidence: buildNycConfidence(context, input),
    reason: 'nyc_location_fragments_present',
    supportingFragmentIds: nycSupportIds,
    metadata: {
      impliedBy: 'location_fragments',
    },
  });
}

function buildStateResolution(context, input) {
  if (!context.hasLocationEvidence) {
    return buildFieldState({
      status: 'unresolved',
      reason: context.allFragmentCount ? 'no_location_evidence_fragments' : 'missing_evidence_fragments',
    });
  }

  const nycSupportIds = collectNycSupportIds(context, input);
  if (!nycSupportIds.length) {
    return buildFieldState({
      status: 'unresolved',
      reason: 'no_nyc_location_support',
    });
  }

  return buildFieldState({
    status: 'accepted',
    value: NYC_STATE,
    confidence: buildNycConfidence(context, input),
    reason: 'nyc_location_fragments_present',
    supportingFragmentIds: nycSupportIds,
    metadata: {
      impliedBy: 'location_fragments',
    },
  });
}

function buildResolvedFieldInput(fieldPath, state, listing, context, options) {
  return {
    fieldPath,
    status: state.status,
    resolutionKind: options.resolutionKind,
    resolverVersion: options.resolverVersion,
    value: state.value ?? null,
    confidence: state.confidence,
    ambiguity: state.ambiguity,
    supportingFragmentIds: state.supportingFragmentIds,
    metadata: compactObject({
      ...state.metadata,
      locationScope: 'nyc',
      candidateCount: state.candidateCount,
      sourceSurfaces: context.sourceSurfaces,
      rawLocation: summarizeRawListingLocation(listing),
      reason: state.reason,
    }),
  };
}

function buildLocationContext(fragments, options = {}) {
  const boroughByValue = new Map();
  const neighborhoodByValue = new Map();
  const addressByValue = new Map();

  for (const fragment of fragments) {
    const confidence = normalizeConfidence(fragment.confidence);

    if (fragment.fieldPath === 'location.neighborhood') {
      const neighborhood = normalizeNeighborhood(fragment.normalized?.neighborhood || fragment.rawText);
      const borough = normalizeBorough(fragment.normalized?.borough || inferBoroughFromNeighborhood(neighborhood));

      if (neighborhood) {
        registerCandidate(neighborhoodByValue, neighborhood, {
          fragment,
          confidence,
          value: neighborhood,
          borough,
        });
      }

      if (borough) {
        registerCandidate(boroughByValue, borough, {
          fragment,
          confidence: confidence * 0.7,
          value: borough,
          inferredFromNeighborhood: true,
        });
      }

      continue;
    }

    if (fragment.fieldPath === 'location.borough') {
      const borough = normalizeBorough(fragment.normalized?.borough || fragment.rawText);
      if (!borough) continue;

      registerCandidate(boroughByValue, borough, {
        fragment,
        confidence,
        value: borough,
      });
      continue;
    }

    if (fragment.fieldPath === 'location.address') {
      const candidateType = normalizeAddressCandidateType(fragment.normalized?.candidateType || fragment.fragmentKind);
      const address = normalizeAddressCandidate(fragment.normalized?.value || fragment.rawText, candidateType);
      if (!address) continue;

      registerCandidate(addressByValue, address, {
        fragment,
        confidence: confidence * (candidateType === 'street_address' ? 1 : 0.88),
        value: address,
        candidateType,
      });
    }
  }

  return {
    allFragmentCount: Number(options.allFragmentCount || 0),
    fragments,
    hasLocationEvidence: fragments.length > 0,
    sourceSurfaces: uniqueStrings(fragments.map((fragment) => fragment.sourceSurface)),
    boroughCandidates: finalizeCandidates(boroughByValue, { includeBorough: false }),
    neighborhoodCandidates: finalizeCandidates(neighborhoodByValue, { includeBorough: true }),
    addressCandidates: finalizeCandidates(addressByValue, { includeAddressType: true }),
  };
}

function buildAddressLocationSupport(input) {
  const neighborhoodState = input?.neighborhoodState;
  const boroughState = input?.boroughState;
  const hasAcceptedNeighborhood = neighborhoodState?.status === 'accepted';
  const hasAcceptedBorough = boroughState?.status === 'accepted';
  const hasCandidateNeighborhood = neighborhoodState?.status === 'candidate';
  const hasCandidateBorough = boroughState?.status === 'candidate';

  return {
    hasAcceptedLocation: hasAcceptedNeighborhood || hasAcceptedBorough,
    hasAnyLocationSupport: hasAcceptedNeighborhood || hasAcceptedBorough || hasCandidateNeighborhood || hasCandidateBorough,
    confidenceBonus: (hasAcceptedNeighborhood ? 0.16 : 0)
      + (hasAcceptedBorough ? 0.12 : 0)
      + (hasCandidateNeighborhood ? 0.05 : 0)
      + (hasCandidateBorough ? 0.04 : 0),
    supportingFragmentIds: uniqueStrings([
      ...(Array.isArray(neighborhoodState?.supportingFragmentIds) ? neighborhoodState.supportingFragmentIds : []),
      ...(Array.isArray(boroughState?.supportingFragmentIds) ? boroughState.supportingFragmentIds : []),
    ]),
  };
}

function collectNycSupportIds(context, input) {
  const neighborhoodIds = Array.isArray(input?.neighborhoodState?.supportingFragmentIds)
    ? input.neighborhoodState.supportingFragmentIds
    : [];
  const boroughIds = Array.isArray(input?.boroughState?.supportingFragmentIds)
    ? input.boroughState.supportingFragmentIds
    : [];

  const directSupport = uniqueStrings([...neighborhoodIds, ...boroughIds]);
  if (directSupport.length) {
    return directSupport;
  }

  return uniqueStrings(
    context.fragments
      .filter((fragment) => fragment.fieldPath === 'location.neighborhood' || fragment.fieldPath === 'location.borough')
      .map((fragment) => fragment.id),
  );
}

function buildNycConfidence(context, input) {
  const boroughConfidence = normalizeConfidence(input?.boroughState?.confidence);
  const neighborhoodConfidence = normalizeConfidence(input?.neighborhoodState?.confidence);
  const topLocationConfidence = Math.max(
    boroughConfidence,
    neighborhoodConfidence,
    context.boroughCandidates[0] ? computeCandidateConfidence(context.boroughCandidates[0]) : 0,
    context.neighborhoodCandidates[0] ? computeCandidateConfidence(context.neighborhoodCandidates[0]) : 0,
  );

  return clamp(topLocationConfidence + 0.08, 0.62, 0.97);
}

function buildFieldState(input) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const topCandidates = candidates.slice(0, 4);

  return {
    status: input.status,
    value: input.value ?? null,
    confidence: normalizeConfidence(input.confidence),
    reason: normalizeString(input.reason) || null,
    supportingFragmentIds: uniqueStrings(input.supportingFragmentIds),
    candidateCount: candidates.length,
    ambiguity: buildAmbiguity(input.status, topCandidates, input.reason),
    metadata: input.metadata || {},
  };
}

function buildAmbiguity(status, candidates, reason) {
  if (status === 'accepted' && candidates.length <= 1) {
    return null;
  }

  return compactObject({
    reason: normalizeString(reason),
    candidates: candidates.map((candidate) => compactObject({
      value: candidate.value,
      confidence: roundNumber(computeCandidateConfidence(candidate)),
      fragmentIds: candidate.fragmentIds,
      sourceSurfaces: candidate.sourceSurfaces,
      rawTexts: candidate.rawTexts,
      borough: candidate.borough,
      candidateType: candidate.candidateType,
    })),
  });
}

function buildCandidateKey(value) {
  return String(value || '').trim().toLowerCase();
}

function registerCandidate(store, key, input) {
  const candidateKey = buildCandidateKey(key);
  if (!candidateKey) return;

  const confidence = normalizeConfidence(input.confidence);
  const existing = store.get(candidateKey) || {
    value: key,
    score: 0,
    bestConfidence: 0,
    fragmentIds: [],
    sourceSurfaces: [],
    rawTexts: [],
    borough: null,
    candidateType: null,
    inferredFromNeighborhoodCount: 0,
  };

  existing.value = key;
  existing.score += confidence;
  existing.bestConfidence = Math.max(existing.bestConfidence, confidence);
  existing.fragmentIds = uniqueStrings([...existing.fragmentIds, input.fragment?.id]);
  existing.sourceSurfaces = uniqueStrings([...existing.sourceSurfaces, input.fragment?.sourceSurface]);
  existing.rawTexts = uniqueStrings([...existing.rawTexts, normalizeString(input.fragment?.rawText)]);
  existing.borough = normalizeString(input.borough) || existing.borough || null;
  existing.candidateType = normalizeString(input.candidateType) || existing.candidateType || null;
  existing.inferredFromNeighborhoodCount += input.inferredFromNeighborhood ? 1 : 0;

  store.set(candidateKey, existing);
}

function finalizeCandidates(store, options = {}) {
  return Array.from(store.values())
    .map((candidate) => ({
      ...candidate,
      score: roundNumber(candidate.score),
      bestConfidence: roundNumber(candidate.bestConfidence),
      sourceSurfaces: uniqueStrings(candidate.sourceSurfaces),
      rawTexts: uniqueStrings(candidate.rawTexts),
      borough: options.includeBorough ? normalizeString(candidate.borough) : null,
      candidateType: options.includeAddressType ? normalizeString(candidate.candidateType) : null,
    }))
    .sort((left, right) => {
      const leftConfidence = computeCandidateConfidence(left);
      const rightConfidence = computeCandidateConfidence(right);
      return rightConfidence - leftConfidence
        || right.score - left.score
        || right.fragmentIds.length - left.fragmentIds.length
        || String(left.value).localeCompare(String(right.value));
    });
}

function collectCandidateSupportIds(candidates) {
  return uniqueStrings(
    candidates.flatMap((candidate) => candidate.fragmentIds),
  );
}

function computeCandidateConfidence(candidate) {
  const sourceSurfaceBonus = Math.max(0, (candidate.sourceSurfaces?.length || 0) - 1) * 0.05;
  const fragmentBonus = Math.max(0, (candidate.fragmentIds?.length || 0) - 1) * 0.03;
  return clamp(
    (normalizeConfidence(candidate.bestConfidence) * 0.7)
      + (Math.min(Number(candidate.score || 0), 1.8) * 0.2)
      + sourceSurfaceBonus
      + Math.min(fragmentBonus, 0.09),
    0,
    0.97,
  );
}

function hasMaterialCompetition(top, second) {
  if (!top || !second) return false;

  const topConfidence = computeCandidateConfidence(top);
  const secondConfidence = computeCandidateConfidence(second);
  const confidenceGap = topConfidence - secondConfidence;
  const scoreRatio = Number(top.score || 0) === 0 ? 0 : Number(second.score || 0) / Number(top.score || 0);

  return secondConfidence >= Math.max(0.5, topConfidence - MATERIAL_COMPETITION_GAP)
    && confidenceGap <= MATERIAL_COMPETITION_GAP
    && (scoreRatio >= MATERIAL_COMPETITION_RATIO || confidenceGap <= 0.04);
}

function summarizeRawListingLocation(listing) {
  const location = isRecord(listing?.payload?.location) ? listing.payload.location : {};

  return compactObject({
    rawText: normalizeString(location.rawText),
    address: normalizeString(location.address),
    neighborhood: normalizeString(location.neighborhood),
    borough: normalizeString(location.borough),
    city: normalizeString(location.city),
    state: normalizeString(location.state),
  });
}

function normalizeAddressCandidate(value, candidateType) {
  const raw = normalizeString(value);
  if (!raw) return null;

  if (candidateType === 'cross_street') {
    const parts = raw
      .split(/\s*(?:\/|&|\band\b)\s*/i)
      .map((part) => normalizeStreetPhrase(part))
      .filter(Boolean);

    if (!parts.length) return null;
    return uniqueStrings(parts).sort((left, right) => left.localeCompare(right)).join(' & ');
  }

  return normalizeStreetPhrase(raw);
}

function normalizeStreetPhrase(value) {
  const raw = normalizeString(value);
  if (!raw) return null;

  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => normalizeStreetToken(token))
    .filter(Boolean)
    .join(' ');
}

function normalizeStreetToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';

  const stripped = raw.replace(/[.,]+$/g, '');
  const lower = stripped.toLowerCase();

  if (DIRECTIONALS.has(lower)) {
    return DIRECTIONALS.get(lower);
  }

  if (STREET_SUFFIXES.has(lower)) {
    return STREET_SUFFIXES.get(lower);
  }

  if (UNIT_MARKERS.has(lower)) {
    return UNIT_MARKERS.get(lower);
  }

  if (/^#?[A-Za-z0-9-]+$/.test(stripped) && /[0-9]/.test(stripped)) {
    return stripped.toUpperCase();
  }

  return stripped
    .split(/([-'])/)
    .map((part) => (/[-']/.test(part) ? part : titleCaseToken(part)))
    .join('');
}

function formatResolvedAddress(address, input) {
  const parts = [
    normalizeString(address),
    normalizeString(input.neighborhood),
    normalizeString(input.borough),
  ].filter(Boolean);

  return parts.join(', ') || null;
}

function normalizeNeighborhood(value) {
  return titleCaseWords(value);
}

function normalizeBorough(value) {
  const normalized = titleCaseWords(value);
  if (!normalized) return null;

  switch (normalized.toLowerCase()) {
    case 'brooklyn':
      return 'Brooklyn';
    case 'manhattan':
      return 'Manhattan';
    case 'queens':
      return 'Queens';
    case 'bronx':
      return 'Bronx';
    case 'staten island':
      return 'Staten Island';
    default:
      return normalized;
  }
}

function normalizeAddressCandidateType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'cross_street_candidate' || normalized === 'cross_street'
    ? 'cross_street'
    : 'street_address';
}

function titleCaseWords(value) {
  const raw = normalizeString(value);
  if (!raw) return null;

  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => titleCaseToken(part))
    .join(' ');
}

function titleCaseToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function isLocationFragment(fragment) {
  return fragment?.fieldPath === 'location.address'
    || fragment?.fieldPath === 'location.neighborhood'
    || fragment?.fieldPath === 'location.borough';
}

function uniqueStrings(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => normalizeString(value))
      .filter(Boolean),
  ));
}

function compactObject(value) {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) return false;
      if (typeof entry === 'string' && entry.trim() === '') return false;
      if (Array.isArray(entry) && !entry.length) return false;
      if (isRecord(entry) && !Object.keys(entry).length) return false;
      return true;
    }),
  );
}

function normalizeConfidence(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 0;
  }

  return clamp(normalized, 0, 0.99);
}

function normalizeString(value) {
  const normalized = typeof value === 'string' ? value.trim() : String(value || '').trim();
  return normalized || null;
}

function roundNumber(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return null;
  return Math.round(normalized * 1000) / 1000;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
