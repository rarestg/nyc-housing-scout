import { createEmptyListing } from '../core/schema.js';
import {
  findExplicitBoroughMatches,
  findNeighborhoodMatches,
  inferBoroughFromNeighborhood,
} from '../core/neighborhoods.js';

const OFFERING_INTENT_RULES = [
  { signal: 'intent_offering_available', weight: 6, pattern: /\b(?:room|bedroom|sublet|sublease|studio|apartment|lease(?:\s+(?:takeover|assignment))?)\b[\s\S]{0,28}\bavailable\b/i },
  { signal: 'intent_offering_unit_available', weight: 6, pattern: /\b(?:entire\s+\d+\s*br|entire apartment|whole apartment|full apartment|studio)\b[\s\S]{0,16}\bavailable\b/i },
  { signal: 'intent_offering_roommate_for_existing_place', weight: 7, pattern: /\b(?:looking|seeking|iso)\s+(?:for\s+)?(?:a\s+|an\s+|up to \d+\s+)?roommates?\s+for\s+(?:this|my|our)\b/i },
  { signal: 'intent_offering_person_fill', weight: 7, pattern: /\b(?:looking|seeking|iso)\s+(?:for\s+)?(?:someone|a person|tenant|replacement|subletter|sublessee)\b/i },
  { signal: 'intent_offering_takeover', weight: 8, pattern: /\b(?:offering a lease(?:\s+(?:assignment|takeover))?|lease takeover on my|take over my lease|take over the lease for my|takeover handled|assign my lease|looking for someone to take over)\b/i },
  { signal: 'intent_offering_sublet', weight: 7, pattern: /\b(?:subletting|sublet available|sublease available|room available for sublet|my room[\s\S]{0,20}\bsublet)\b/i },
  { signal: 'intent_offering_have_space', weight: 6, pattern: /\b(?:roommate wanted|room available|private room|bedroom available|my room|move in ready|vacating|you['’]ll have|i have a|we have a)\b/i },
  { signal: 'intent_offering_contact', weight: 2, pattern: /\b(?:dm|message|text|call)\b[\s\S]{0,20}\b(?:interested|me|asap)\b/i },
];

const WANTED_INTENT_RULES = [
  { signal: 'intent_wanted_iso_housing', weight: 8, pattern: /(?:^|[.!?\n]\s*)iso\s+(?:a|an|new|private|furnished|short[- ]term|summer|spring|fall|entire)?\s*(?:room|bedroom|apartment|studio|sublet|sublease|lease takeover|lease assignment|place|housing|1br|2br|3br|4br|full place|entire apartment|entire place)\b/i },
  { signal: 'intent_wanted_iso_extended', weight: 8, pattern: /(?:^|[.!?\n]\s*)iso\b[\s\S]{0,48}\b(?:new lease|lease takeover|lease assignment|entire apartment|entire place|full place|room|bedroom|apartment|studio|sublet|place|housing)\b/i },
  { signal: 'intent_wanted_searching_housing', weight: 8, pattern: /(?:^|[.!?\n]\s*)(?:looking|searching|seeking)(?:\s+for)?\s+(?:a|an|new|private|furnished|short[- ]term|summer|spring|fall|monthly|entire)?\s*(?:room|bedroom|apartment|studio|sublet|sublease|lease takeover|lease assignment|place|housing|1br|2br|3br|4br|full place|entire apartment|entire place)\b/i },
  { signal: 'intent_wanted_need_housing', weight: 7, pattern: /(?:^|[.!?\n]\s*)(?:need|needing|want)\s+(?:a|an|new|private|furnished|short[- ]term|summer|spring|fall|entire)?\s*(?:room|bedroom|apartment|studio|sublet|sublease|lease takeover|lease assignment|place|housing)\b/i },
  { signal: 'intent_wanted_roommate_hunt', weight: 9, pattern: /(?:^|[.!?\n]\s*)(?:looking|searching|seeking|iso)\s+(?:for\s+)?(?:up to \d+\s+)?roommates?\s+to\s+(?:find|look for|search for|apartment hunt|hunt for)\b/i },
  { signal: 'intent_wanted_group_search', weight: 7, pattern: /(?:^|[.!?\n]\s*)(?:we are|we're)\s+[^.!?\n]{0,80}\s+looking for\b[\s\S]{0,100}\b(?:apartment|place|lease takeover|sublet|housing)\b/i },
  { signal: 'intent_wanted_budget', weight: 2, pattern: /\bbudget\b/i },
  { signal: 'intent_wanted_preferences', weight: 1, pattern: /\b(?:preferably|open to)\b/i },
];

const LISTING_TYPE_RULES = {
  lease_takeover: [
    { signal: 'type_lease_takeover', weight: 9, pattern: /\b(?:lease takeover|lease assignment|assign(?:ment)? my lease|take over my lease|take over the lease)\b/i },
  ],
  sublet: [
    { signal: 'type_sublet', weight: 8, pattern: /\b(?:sublet|sublease|subletter|subletting|sublessee)\b/i },
  ],
  short_term: [
    { signal: 'type_short_term', weight: 7, pattern: /\b(?:short[- ]term|short stay|one-off short stays?|part-time room|nightly|nights?\/per month)\b/i },
  ],
  room_in_shared: [
    { signal: 'type_room_shared', weight: 7, pattern: /\b(?:private room|room available|room for rent|bedroom available|my room|second bedroom available|roommate wanted)\b/i },
    { signal: 'type_roommate_for_existing_place', weight: 7, pattern: /\b(?:looking|seeking|iso)\s+(?:for\s+)?roommates?\s+for\s+(?:this|my|our)\b/i },
    { signal: 'type_room_shared_living', weight: 5, pattern: /\b(?:living with|you['’]ll be living with|my roommate|our roommate|share of utilities)\b/i },
  ],
  multiple_rooms_in_shared: [
    { signal: 'type_multiple_rooms', weight: 8, pattern: /\b(?:\d+|two|three)\s+(?:rooms|bedrooms?)\s+(?:available|open)\b/i },
  ],
  entire_apartment: [
    { signal: 'type_entire_place', weight: 8, pattern: /\b(?:entire apartment|whole apartment|full apartment|entire place|whole place|full place|entire \d+\s*br)\b/i },
    { signal: 'type_entire_unit', weight: 7, pattern: /\b(?:studio apartment|studio\b|1\s*(?:br|bed|bedroom)\b|one bedroom\b|penthouse|duplex|railroad apartment)\b/i },
    { signal: 'type_entire_address', weight: 5, pattern: /\b\d{2,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard)\b/ },
  ],
  roommate_search: [
    { signal: 'type_roommate_search', weight: 8, pattern: /\broommates?\s+to\s+(?:find|look for|search for|apartment hunt|hunt for)\b/i },
    { signal: 'type_roommate_search_simple', weight: 5, pattern: /(?:^|[.!?\n]\s*)(?:looking|searching|seeking|iso)\s+(?:for\s+)?(?:up to \d+\s+)?roommates?\b(?!\s+for\s+(?:this|my|our)\b)/i },
  ],
};

export function extractFromText(input) {
  return extractListingsFromText(input)[0] ?? createEmptyListing();
}

export function extractListingsFromText(input) {
  const text = normalizeInput(input);
  return extractListings(text);
}

export function extractFromPost(post) {
  return extractListingsFromPost(post)[0] ?? createEmptyListing({ source: buildListingSource(post) });
}

export function extractListingsFromPost(post) {
  const text = normalizeInput(post?.bodyText || '');
  return extractListings(text, buildListingSource(post));
}

function extractListings(text, source = null) {
  const sections = splitIntoCandidateSections(text);
  const shared = extractSharedContext(text);

  if (sections.length <= 1) {
    return [buildListingFromText(text, shared, source)];
  }

  return sections.map((section) => buildListingFromText(section, shared, source));
}

function buildListingFromText(text, shared = {}, source = null) {
  const listing = createEmptyListing({ source });

  if (!text) {
    listing.notes.ambiguities.push('No text provided');
    return listing;
  }

  const pricing = findPricing(text);
  const location = analyzeLocation(text, shared);
  const intent = analyzePostIntent(text);
  const type = analyzeListingType(text, {
    postIntent: intent.value,
    roomsAvailable: findRoomsAvailable(text),
    totalBedrooms: findBedrooms(text) || shared.totalBedrooms || null,
  });

  listing.notes.summary = text.slice(0, 240);
  listing.postIntent = intent.value;
  listing.location.rawText = location.rawText;
  listing.location.neighborhood = location.neighborhood;
  listing.location.borough = location.borough;
  listing.pricing.amount = pricing.amount;
  listing.pricing.period = pricing.period;
  listing.rooms.totalBedrooms = type.context.totalBedrooms;
  listing.rooms.roomsAvailable = type.context.roomsAvailable;
  listing.listingType = type.value;
  listing.dates.availableFrom = findAvailableDateText(text);
  listing.dates.leaseTermText = findLeaseTermText(text);
  listing.features.furnished = detectFurnished(text);
  listing.notes.rawSignals = collectSignals(text, { intent, type, location, pricing });
  listing.notes.ambiguities.push(...findAmbiguities(text, listing, { intent, type, location, pricing }));
  listing.confidence.fields = buildFieldConfidence(listing, { intent, type, location, pricing });
  listing.confidence.overall = buildOverallConfidence(listing.confidence.fields, listing.notes.ambiguities);

  return listing;
}

function normalizeInput(input) {
  return String(input || '')
    .replace(/\r/g, '')
    .replace(/[\u00A0\t]+/g, ' ')
    .replace(/\n?comments of interest:[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/…\s*See more/gi, '')
    .replace(/\bSee more\b/gi, '')
    .trim();
}

function splitIntoCandidateSections(text) {
  const markers = [
    /(?:^|[\n.!?]\s*|\s+)(?:1️⃣|1\)|1\.(?=\s)|option\s*1|part-time room:|temporary:)\s*/ig,
    /(?:^|[\n.!?]\s*|\s+)(?:2️⃣|2\)|2\.(?=\s)|option\s*2|more long-term:|entire\s+\d+\s*br\s+available:)\s*/ig,
    /(?:^|[\n.!?]\s*|\s+)(?:3️⃣|3\.(?=\s)|option\s*3)\s*/ig,
  ];

  const hits = [];

  for (const pattern of markers) {
    for (const match of text.matchAll(pattern)) {
      hits.push(match.index ?? 0);
    }
  }

  const uniqueHits = Array.from(new Set(hits)).sort((a, b) => a - b);

  if (uniqueHits.length < 2) return [text];

  const sections = [];
  for (let i = 0; i < uniqueHits.length; i += 1) {
    const start = uniqueHits[i];
    const end = uniqueHits[i + 1] ?? text.length;
    sections.push(text.slice(start, end).trim());
  }
  return sections.filter(Boolean);
}

function extractSharedContext(text) {
  const location = analyzeLocation(text);
  return {
    neighborhood: location.neighborhood,
    borough: location.borough,
    locationRawText: location.rawText,
    totalBedrooms: findBedrooms(text),
  };
}

function findPricing(text) {
  const candidates = [
    ...collectRangePricingCandidates(text),
    ...collectSinglePricingCandidates(text),
  ];

  if (!candidates.length) {
    return { amount: null, period: 'unknown', candidates: [], mixedPeriods: false, isFlexible: false };
  }

  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  const periods = new Set(candidates.map((candidate) => candidate.period).filter((period) => period && period !== 'unknown'));
  return {
    amount: candidates[0].amount,
    period: candidates[0].period,
    candidates,
    mixedPeriods: periods.size > 1,
    isFlexible: /\b(?:depending on usage|open to negotiating|negotiable|flexible on price)\b/i.test(text),
  };
}

function findBedrooms(text) {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:br|bed|beds|bedroom|bedrooms)\b/i,
    /(?:apartment|apt|unit)\s*(?:is|has)?\s*(\d+(?:\.\d+)?)\s*(?:bed|bedroom|bedrooms)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }

  return null;
}

function findRoomsAvailable(text) {
  const patterns = [
    /(\d+)\s*(?:room|rooms)\s*(?:available|open)/i,
    /second bedroom available/i,
    /one private room available/i,
    /part-time room/i,
    /room for rent/i,
    /private room/i,
    /my room/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (match[1]) return Number(match[1]);
    return 1;
  }

  return null;
}

function findLocationSnippet(text) {
  const patterns = [
    /(?:^|\n)(?:location|neighborhood|located)\s*:?\s*([^\n]+)/i,
    /\b(?:on|at|near|off)\s+([A-Z][A-Za-z.'&-]+(?:\s+[A-Z][A-Za-z.'&-]+){0,3}\s*(?:\/|and)\s*[A-Z][A-Za-z.'&-]+(?:\s+[A-Z][A-Za-z.'&-]+){0,3})/i,
    /(?:located in|in|near|around|close to)\s+([A-Z][A-Za-z.'&-]+(?:\s+[A-Z][A-Za-z.'&-]+){0,4}(?:,\s*(?:Brooklyn|Queens|Manhattan|Bronx|Staten Island))?)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return cleanLocationSnippet(match[1] || match[0]);
  }

  return null;
}

function findAvailableDateText(text) {
  const explicit = text.match(/(?:available|move[- ]?in|starting)\s*(?:from|on)?\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?|asap|immediately|now)/i);
  if (explicit) return explicit[1];

  const ranged = text.match(/([A-Za-z]+\s+\d{1,2}\s*[–-]\s*[A-Za-z]+\s*\d{1,2}|[A-Za-z]+\s+\d{1,2}\s*(?:and|,)\s*[A-Za-z]+\s*\d{1,2}[–-]\d{1,2})/i);
  return ranged ? ranged[1] : null;
}

function findLeaseTermText(text) {
  const match = text.match(/(~?\d+\s*[–-]\s*\d+\s*nights?\/per month|one-off short stays|short stays?|option to renew|lease runs through [A-Za-z]+\s+\d{1,2}|6 months?\s*(?:to|-)\s*\d+\s*(?:months?|year))/i);
  return match ? match[1] : null;
}

function detectFurnished(text) {
  if (/unfurnished/i.test(text)) return false;
  if (/furnished/i.test(text)) return true;
  return null;
}

function collectSignals(text, analyses) {
  const signals = new Set([
    ...analyses.intent.signals,
    ...analyses.type.signals,
    ...analyses.location.signals,
  ]);
  const lower = text.toLowerCase();
  for (const word of ['laundry', 'furnished', 'unfurnished', 'pets', 'broker fee', 'utilities included', 'sublet', 'lease takeover', 'short stay', 'near the water']) {
    if (lower.includes(word)) signals.add(word);
  }
  if (analyses.pricing.mixedPeriods) signals.add('pricing_mixed_periods');
  if (analyses.pricing.isFlexible) signals.add('pricing_flexible');
  return Array.from(signals);
}

function findAmbiguities(text, listing, analyses) {
  const ambiguities = [];
  if (!listing.location.rawText && !listing.location.neighborhood && !listing.location.borough) ambiguities.push('Location not confidently detected');
  if (analyses.location.multipleNeighborhoods) ambiguities.push('Location mentions multiple neighborhoods');
  if (analyses.location.ambiguousBorough) ambiguities.push('Location mentions multiple boroughs');
  if (!listing.pricing.amount) ambiguities.push('Price not confidently detected');
  if (!listing.rooms.totalBedrooms && !listing.rooms.roomsAvailable && listing.listingType !== 'roommate_search') ambiguities.push('Room count unclear');
  if (analyses.pricing.mixedPeriods) ambiguities.push('Mixed pricing periods detected');
  if (analyses.pricing.isFlexible || /depending on usage/i.test(text)) ambiguities.push('Price varies depending on usage');
  if (analyses.intent.ambiguous) ambiguities.push('Post intent is mixed or unclear');
  if (analyses.type.ambiguous) ambiguities.push('Listing type is mixed or unclear');
  if (/extended/i.test(text)) ambiguities.push('End date may be extendable');
  return ambiguities;
}

function buildFieldConfidence(listing, analyses) {
  return {
    postIntent: analyses.intent.confidence,
    listingType: analyses.type.confidence,
    location: analyses.location.confidence,
    borough: analyses.location.boroughConfidence,
    price: buildPriceConfidence(listing.pricing.amount, analyses.pricing),
    rooms: buildRoomConfidence(listing),
    dates: listing.dates.availableFrom ? 0.72 : 0.18,
  };
}

function buildOverallConfidence(fields, ambiguities) {
  const base = average(Object.values(fields));
  return clamp(base - Math.min(0.28, ambiguities.length * 0.045));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildListingSource(post) {
  if (!post) return undefined;

  const source = post.source || {};
  return {
    platform: source.platform || post.platform || 'facebook',
    sourceKey: source.sourceKey || post.sourceKey || null,
    groupName: source.groupName || post.groupName || null,
    postUrl: source.postUrl || post.postUrl || null,
    postId: source.postId || post.postId || null,
    authorName: source.authorName || post.authorName || post.author || null,
    capturedAt: source.capturedAt || post.capturedAt || new Date().toISOString(),
    postedAtText: source.postedAtText || post.postedAtText || null,
    captureMethod: source.captureMethod || post.captureMethod || null,
    captureRunId: source.captureRunId || post.captureRunId || null,
    rawArtifactPath: source.rawArtifactPath || post.rawArtifactPath || null,
  };
}

function analyzePostIntent(text) {
  const offering = applyRuleSet(text, OFFERING_INTENT_RULES);
  const wanted = applyRuleSet(text, WANTED_INTENT_RULES);
  const strongest = Math.max(offering.score, wanted.score);
  const gap = Math.abs(offering.score - wanted.score);
  let value = 'unknown';
  let ambiguous = false;

  if (offering.score >= wanted.score + 3 && offering.score >= 4) {
    value = 'offering';
  } else if (wanted.score >= offering.score + 3 && wanted.score >= 4) {
    value = 'wanted';
  } else if (strongest >= 4) {
    ambiguous = true;
  }

  return {
    value,
    ambiguous,
    confidence: computeAnalyticConfidence(value, strongest, gap, ambiguous),
    scores: {
      offering: offering.score,
      wanted: wanted.score,
    },
    signals: [...offering.signals, ...wanted.signals],
  };
}

function analyzeListingType(text, context) {
  const buckets = Object.fromEntries(
    Object.entries(LISTING_TYPE_RULES).map(([key, rules]) => [key, applyRuleSet(text, rules)]),
  );
  const roomSignals = /\b(?:roommate wanted|private room|room available|room for rent|bedroom available|second bedroom|my room)\b/i.test(text);
  const fullUnitSignals = /\b(?:entire apartment|whole apartment|full apartment|entire place|full place|whole place|studio\b|1\s*(?:br|bed|bedroom)\b|one bedroom\b|penthouse|duplex)\b/i.test(text);

  if (context.roomsAvailable && context.roomsAvailable > 1) {
    addScore(buckets.multiple_rooms_in_shared, 8, 'type_multiple_rooms_count');
  } else if (context.roomsAvailable === 1) {
    addScore(buckets.room_in_shared, 3, 'type_single_room_count');
  }

  if (context.postIntent === 'offering' && /\broommate wanted\b/i.test(text)) {
    addScore(buckets.room_in_shared, 5, 'type_roommate_wanted_offer');
  }

  if (context.postIntent === 'wanted' && /\b(?:looking|searching|seeking|iso)\s+(?:for\s+)?(?:up to \d+\s+)?roommates?\b/i.test(text)) {
    addScore(buckets.roommate_search, 4, 'type_roommate_search_wanted');
  }

  if (context.totalBedrooms && context.totalBedrooms >= 1 && !roomSignals && (fullUnitSignals || context.postIntent === 'offering')) {
    addScore(buckets.entire_apartment, 2, 'type_total_bedrooms_unit');
  }

  if (/\b(?:you['’]ll have your own|you would have your own)\b/i.test(text)) {
    addScore(buckets.room_in_shared, 3, 'type_private_room_language');
  }

  const ranked = Object.entries(buckets).sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]));
  const top = ranked[0];
  const second = ranked[1];
  let value = 'unknown';

  if (context.postIntent === 'wanted') {
    if (buckets.roommate_search.score >= 6 && buckets.roommate_search.score >= Math.max(
      buckets.room_in_shared.score,
      buckets.entire_apartment.score,
      buckets.sublet.score,
      buckets.lease_takeover.score,
    )) {
      value = 'roommate_search';
    } else if (buckets.sublet.score >= 7) {
      value = 'sublet';
    } else if (buckets.room_in_shared.score >= 7 && buckets.room_in_shared.score >= buckets.entire_apartment.score + 1) {
      value = 'room_in_shared';
    } else if (buckets.entire_apartment.score >= 7) {
      value = 'entire_apartment';
    } else if (buckets.lease_takeover.score >= 7) {
      value = 'lease_takeover';
    }
  }

  if (value === 'unknown') {
    if (buckets.lease_takeover.score >= 8) {
      value = 'lease_takeover';
    } else if (buckets.sublet.score >= 8 && buckets.sublet.score >= buckets.lease_takeover.score) {
      value = 'sublet';
    } else if (buckets.short_term.score >= 8 && buckets.short_term.score >= Math.max(buckets.room_in_shared.score, buckets.entire_apartment.score) + 2) {
      value = 'short_term';
    } else if (buckets.multiple_rooms_in_shared.score >= 8) {
      value = 'multiple_rooms_in_shared';
    } else if (buckets.room_in_shared.score >= 7 && buckets.room_in_shared.score >= buckets.entire_apartment.score + 1) {
      value = 'room_in_shared';
    } else if (buckets.entire_apartment.score >= 7) {
      value = 'entire_apartment';
    } else if (buckets.roommate_search.score >= 6) {
      value = 'roommate_search';
    } else if (top?.[1].score >= 5) {
      value = top[0];
    }
  }

  const topScore = top?.[1].score ?? 0;
  const secondScore = second?.[1].score ?? 0;
  const ambiguous = value !== 'unknown'
    && second
    && second[0] !== value
    && secondScore >= 6
    && topScore - secondScore <= 1;

  return {
    value,
    ambiguous,
    confidence: computeAnalyticConfidence(value, topScore, topScore - secondScore, ambiguous),
    scores: Object.fromEntries(Object.entries(buckets).map(([key, bucket]) => [key, bucket.score])),
    signals: Array.from(new Set(Object.values(buckets).flatMap((bucket) => bucket.signals))),
    context,
  };
}

function analyzeLocation(text, shared = {}) {
  const neighborhoodMatches = findNeighborhoodMatches(text);
  const explicitBoroughMatches = findExplicitBoroughMatches(text);
  const topNeighborhood = neighborhoodMatches[0] ?? null;
  const topExplicitBorough = explicitBoroughMatches[0] ?? null;
  const fallbackNeighborhood = shared.neighborhood || null;
  const fallbackBorough = shared.borough || null;
  const neighborhood = topNeighborhood?.name || fallbackNeighborhood || null;
  const inferredBorough = inferBoroughFromNeighborhood(neighborhood);
  let borough = inferredBorough || topExplicitBorough?.borough || fallbackBorough || null;
  let ambiguousBorough = false;

  if (inferredBorough && topExplicitBorough?.borough && inferredBorough !== topExplicitBorough.borough) {
    if (topExplicitBorough.score >= (topNeighborhood?.score ?? 0) + 4) {
      borough = topExplicitBorough.borough;
    } else if (topNeighborhood) {
      borough = inferredBorough;
    } else {
      borough = inferredBorough || null;
      ambiguousBorough = !borough;
    }
  }

  const multipleNeighborhoods = neighborhoodMatches.length > 1
    && neighborhoodMatches[1].name !== topNeighborhood?.name
    && neighborhoodMatches[1].score >= (topNeighborhood?.score ?? 0) - 1;

  const rawText = findLocationSnippet(text)
    || topNeighborhood?.name
    || topExplicitBorough?.borough
    || shared.locationRawText
    || null;
  const confidence = buildLocationConfidence({ neighborhood, borough, rawText, multipleNeighborhoods, ambiguousBorough });
  const boroughConfidence = borough
    ? clamp((confidence + (neighborhood || topExplicitBorough ? 0.12 : 0)) / 1.05)
    : 0.12;
  const signals = [];

  if (neighborhood) signals.push(`location_neighborhood_${slugifySignal(neighborhood)}`);
  if (borough) signals.push(`location_borough_${slugifySignal(borough)}`);
  if (!neighborhood && rawText) signals.push('location_raw_only');
  if (multipleNeighborhoods) signals.push('location_multiple_neighborhoods');
  if (ambiguousBorough) signals.push('location_multiple_boroughs');

  return {
    neighborhood,
    borough,
    rawText,
    confidence,
    boroughConfidence,
    multipleNeighborhoods,
    ambiguousBorough,
    signals,
  };
}

function applyRuleSet(text, rules) {
  const bucket = { score: 0, signals: [] };

  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      addScore(bucket, rule.weight, rule.signal);
    }
  }

  return bucket;
}

function addScore(bucket, weight, signal) {
  bucket.score += weight;
  bucket.signals.push(signal);
}

function computeAnalyticConfidence(value, strongestScore, gap, ambiguous) {
  if (value === 'unknown') return 0.28;

  let confidence = 0.45;
  confidence += Math.min(0.22, strongestScore * 0.03);
  confidence += Math.min(0.18, gap * 0.035);
  if (ambiguous) confidence -= 0.18;

  return clamp(confidence);
}

function buildLocationConfidence(input) {
  if (input.ambiguousBorough) return 0.24;
  if (input.neighborhood && input.borough && !input.multipleNeighborhoods) return 0.88;
  if (input.neighborhood && input.borough) return 0.74;
  if (input.neighborhood) return 0.7;
  if (input.borough) return 0.62;
  if (input.rawText) return 0.38;
  return 0.14;
}

function buildPriceConfidence(amount, pricing) {
  if (!amount) return 0.12;
  let confidence = 0.9;
  if (pricing.mixedPeriods) confidence -= 0.18;
  if (pricing.isFlexible) confidence -= 0.15;
  return clamp(confidence);
}

function buildRoomConfidence(listing) {
  if (listing.rooms.totalBedrooms || listing.rooms.roomsAvailable) return 0.78;
  if (listing.listingType === 'entire_apartment' || listing.listingType === 'lease_takeover' || listing.listingType === 'sublet') return 0.36;
  return 0.14;
}

function cleanLocationSnippet(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[|•]+/g, ' ')
    .replace(/[.!?]\s+[A-Z].*$/g, '')
    .replace(/\s+(?:and|with)\s+easy\s+access.*$/i, '')
    .replace(/[.,;:]+$/g, '')
    .trim()
    .slice(0, 120) || null;
}

function slugifySignal(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function clamp(value) {
  return Number(Math.max(0.05, Math.min(0.95, value)).toFixed(2));
}

function collectRangePricingCandidates(text) {
  const candidates = [];
  const rangePattern = /~?\$\s*([0-9]+(?:\.[0-9]+)?)\s*[–-]\s*([0-9]+(?:\.[0-9]+)?)\s*K\s*(?:\/|\b(?:per|a)\b)?\s*(month|mo|monthly|week|wk|weekly|night|nights?)/ig;

  for (const match of text.matchAll(rangePattern)) {
    candidates.push({
      amount: Math.round(Number(match[1]) * 1000),
      period: normalizePricingPeriod(match[3]),
      score: pricingScore(match[3], true),
      index: match.index ?? 0,
    });
  }

  return candidates;
}

function collectSinglePricingCandidates(text) {
  const candidates = [];
  const explicitPattern = /~?\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d+)?|[0-9]+(?:\.\d+)?)\s*(K)?\s*(?:\/|\b(?:per|a)\b)?\s*(month|mo|monthly|week|wk|weekly|night|nights?)/ig;
  const fallbackPattern = /~?\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d+)?|[0-9]+(?:\.\d+)?)\s*(K)?\b/ig;

  for (const match of text.matchAll(explicitPattern)) {
    candidates.push({
      amount: parsePricingAmount(match[1], match[2]),
      period: normalizePricingPeriod(match[3]),
      score: pricingScore(match[3], true),
      index: match.index ?? 0,
    });
  }

  for (const match of text.matchAll(fallbackPattern)) {
    const amount = parsePricingAmount(match[1], match[2]);
    if (!amount) continue;
    if (candidates.some((candidate) => candidate.index === (match.index ?? 0) && candidate.amount === amount)) continue;
    candidates.push({
      amount,
      period: inferFallbackPricingPeriod(text, match.index ?? 0, match[0].length),
      score: pricingScore(null, false, text, match.index ?? 0),
      index: match.index ?? 0,
    });
  }

  return candidates;
}

function parsePricingAmount(value, isThousands) {
  const numeric = Number(String(value || '').replace(/,/g, ''));
  if (!numeric) return null;
  return isThousands ? Math.round(numeric * 1000) : numeric;
}

function normalizePricingPeriod(value) {
  if (/month|mo|monthly/i.test(value || '')) return 'month';
  if (/week|wk|weekly/i.test(value || '')) return 'week';
  if (/night/i.test(value || '')) return 'night';
  return 'unknown';
}

function inferFallbackPricingPeriod(text, index, length) {
  const window = text.slice(Math.max(0, index - 20), index + length + 30);
  if (/\b(month|monthly|mo)\b/i.test(window)) return 'month';
  if (/\b(week|weekly|wk)\b/i.test(window)) return 'week';
  if (/\bnight\b/i.test(window)) return 'night';
  if (/\b(rent|lease|sublet|room|apartment|studio|bedroom)\b/i.test(text)) return 'month';
  return 'unknown';
}

function pricingScore(periodHint, explicitPeriod, text = '', index = 0) {
  const period = normalizePricingPeriod(periodHint);
  const periodWeight = {
    month: 300,
    week: 200,
    night: 100,
    unknown: 25,
  };
  const nearby = text.slice(Math.max(0, index - 20), index + 20);
  const rentWeight = /\b(rent|lease|sublet)\b/i.test(nearby) ? 15 : 0;
  return periodWeight[period] + (explicitPeriod ? 50 : 0) + rentWeight;
}
