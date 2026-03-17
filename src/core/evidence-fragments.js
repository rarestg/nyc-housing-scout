import { findExplicitBoroughMatches, findNeighborhoodMatches } from './neighborhoods.js';
import { cleanPostBodyText } from './post-cleaning.js';

export const EVIDENCE_ENRICHMENT_PRODUCER_KIND = 'observation_enrichment';
export const EVIDENCE_ENRICHMENT_PRODUCER_VERSION = 'evidence-enrichment-v1';

const MAX_LOCATION_MATCHES = 3;
const STREET_SUFFIX_PATTERN = String.raw`(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|pl|place|way|terrace|ter|pkwy|parkway)`;
const STREET_WORD_PATTERN = String.raw`[A-Z0-9][A-Za-z0-9'.&-]*`;
const ADDRESS_PATTERN = new RegExp(
  String.raw`\b\d{1,5}\s+(?:[NSEW]\.?\s+)?${STREET_WORD_PATTERN}(?:\s+${STREET_WORD_PATTERN}){0,4}\s+${STREET_SUFFIX_PATTERN}\b(?:\s*(?:apt|apartment|unit|#|fl|floor)\s*[A-Za-z0-9-]+)?`,
  'ig',
);
const CROSS_STREET_PATTERN = new RegExp(
  String.raw`\b${STREET_WORD_PATTERN}(?:\s+${STREET_WORD_PATTERN}){0,2}\s+${STREET_SUFFIX_PATTERN}\s*(?:/|&|and)\s*${STREET_WORD_PATTERN}(?:\s+${STREET_WORD_PATTERN}){0,2}\s+${STREET_SUFFIX_PATTERN}\b`,
  'ig',
);
const PRICE_PATTERN = /\$\s*(\d{1,2}(?:\.\d+)?k|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{3,5}(?:\.\d+)?)(?:\s*(?:\/|per\s+)?(month|mo|monthly|week|wk|weekly|day|daily))?/ig;
const BEDROOM_PATTERN = /(\d+(?:\.\d+)?)\s*[- ]?(?:br|bed|beds|bedroom|bedrooms)\b/ig;
const BATHROOM_PATTERN = /(\d+(?:\.\d+)?)\s*[- ]?(?:bath|baths|bathroom|bathrooms)\b/ig;
const AVAILABILITY_PATTERN = /(?:available|move[- ]?in|starting|start(?:\s+date)?|lease(?:\s+start)?(?:\s+date)?)\s*(?:is\s*)?(?:from|on)?\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?|asap|immediately|now|mid[- ]?[A-Za-z]+|late\s+[A-Za-z]+|early\s+[A-Za-z]+)/ig;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/ig;
const INSTAGRAM_PATTERN = /(?:instagram|insta|ig)\s*(?:[:\-]|is|@)?\s*(@[A-Za-z0-9._]{2,30})/ig;
const TELEGRAM_PATTERN = /(?:telegram|tg)\s*(?:[:\-]|is|@)?\s*(@?[A-Za-z0-9._]{2,32})/ig;
const WHATSAPP_PATTERN = /(?:whatsapp|wa)\s*(?:[:\-]|is)?\s*([+0-9][0-9()\-\s]{7,}[0-9])/ig;

export function buildObservationEvidenceFragments(observation, options = {}) {
  const producerKind = normalizeString(options.producerKind) || EVIDENCE_ENRICHMENT_PRODUCER_KIND;
  const producerVersion = normalizeString(options.producerVersion) || EVIDENCE_ENRICHMENT_PRODUCER_VERSION;
  const fragments = [];
  const payload = isRecord(observation?.payload) ? observation.payload : {};

  appendTextEvidenceFragments(fragments, {
    text: observation?.bodyText,
    sourceSurface: 'body_text',
    sourceRef: '/bodyText',
  });

  const comments = Array.isArray(observation?.comments) ? observation.comments : [];
  comments.forEach((comment, index) => {
    appendTextEvidenceFragments(fragments, {
      text: comment,
      sourceSurface: 'comments',
      sourceRef: `/comments/${index}`,
      metadata: {
        commentIndex: index,
      },
    });
  });

  appendMediaEvidenceFragments(fragments, {
    media: Array.isArray(observation?.media) ? observation.media : [],
    attachmentSummary: payload.attachmentSummary,
  });

  appendCaptureEvidenceFragments(fragments, observation);
  appendNetworkEvidenceFragments(fragments, observation);

  return dedupeFragments(
    fragments.map((fragment) => ({
      ...fragment,
      producerKind,
      producerVersion,
    })),
  );
}

function appendTextEvidenceFragments(fragments, input) {
  const text = cleanPostBodyText(input.text || '');
  if (!text) return;

  for (const match of matchAll(ADDRESS_PATTERN, text)) {
    fragments.push(buildTextFragment({
      fragmentKind: 'address_candidate',
      fieldPath: 'location.address',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        value: match[0],
        candidateType: 'street_address',
      },
      confidence: 0.94,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(CROSS_STREET_PATTERN, text)) {
    fragments.push(buildTextFragment({
      fragmentKind: 'cross_street_candidate',
      fieldPath: 'location.address',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        value: match[0],
        candidateType: 'cross_street',
      },
      confidence: 0.72,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of findNeighborhoodMatches(text).slice(0, MAX_LOCATION_MATCHES)) {
    fragments.push(buildTextFragment({
      fragmentKind: 'neighborhood_candidate',
      fieldPath: 'location.neighborhood',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match.value,
      normalized: {
        neighborhood: match.name,
        borough: match.borough,
      },
      confidence: clamp(0.42 + (Number(match.score || 0) * 0.08), 0.42, 0.95),
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of findExplicitBoroughMatches(text).slice(0, MAX_LOCATION_MATCHES)) {
    fragments.push(buildTextFragment({
      fragmentKind: 'borough_candidate',
      fieldPath: 'location.borough',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match.value,
      normalized: {
        borough: match.borough,
      },
      confidence: clamp(0.4 + (Number(match.score || 0) * 0.09), 0.4, 0.94),
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(PRICE_PATTERN, text)) {
    const amount = parseMoneyAmount(match[1]);
    if (amount === null) continue;

    fragments.push(buildTextFragment({
      fragmentKind: 'price_candidate',
      fieldPath: 'pricing.amount',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        amount,
        currency: 'USD',
        period: normalizePricingPeriod(match[2]),
      },
      confidence: match[2] ? 0.88 : 0.8,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(BEDROOM_PATTERN, text)) {
    const value = normalizeCount(match[1]);
    if (value === null) continue;

    fragments.push(buildTextFragment({
      fragmentKind: 'bedroom_candidate',
      fieldPath: 'rooms.totalBedrooms',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        value,
      },
      confidence: 0.79,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(BATHROOM_PATTERN, text)) {
    const value = normalizeCount(match[1]);
    if (value === null) continue;

    fragments.push(buildTextFragment({
      fragmentKind: 'bathroom_candidate',
      fieldPath: 'rooms.bathrooms',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        value,
      },
      confidence: 0.78,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(AVAILABILITY_PATTERN, text)) {
    fragments.push(buildTextFragment({
      fragmentKind: 'availability_candidate',
      fieldPath: 'dates.availableFrom',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[1],
      normalized: {
        text: match[1],
      },
      confidence: 0.73,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(EMAIL_PATTERN, text)) {
    fragments.push(buildTextFragment({
      fragmentKind: 'email_contact',
      fieldPath: 'contact.references',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        kind: 'email',
        value: match[0].toLowerCase(),
      },
      confidence: 0.99,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(PHONE_PATTERN, text)) {
    const normalizedPhone = normalizePhone(match[0]);
    if (!normalizedPhone) continue;

    fragments.push(buildTextFragment({
      fragmentKind: 'phone_contact',
      fieldPath: 'contact.references',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        kind: 'phone',
        value: normalizedPhone,
      },
      confidence: 0.96,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(URL_PATTERN, text)) {
    if (!isOutboundReferenceUrl(match[0])) continue;

    fragments.push(buildTextFragment({
      fragmentKind: 'external_url_reference',
      fieldPath: 'contact.references',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        kind: 'url',
        value: match[0],
      },
      confidence: 0.92,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(INSTAGRAM_PATTERN, text)) {
    const handle = normalizeHandle(match[1]);
    if (!handle) continue;

    fragments.push(buildTextFragment({
      fragmentKind: 'instagram_contact',
      fieldPath: 'contact.references',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        kind: 'instagram',
        value: handle,
      },
      confidence: 0.93,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(TELEGRAM_PATTERN, text)) {
    const handle = normalizeHandle(match[1]);
    if (!handle) continue;

    fragments.push(buildTextFragment({
      fragmentKind: 'telegram_contact',
      fieldPath: 'contact.references',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        kind: 'telegram',
        value: handle,
      },
      confidence: 0.9,
      text,
      match,
      metadata: input.metadata,
    }));
  }

  for (const match of matchAll(WHATSAPP_PATTERN, text)) {
    const normalizedPhone = normalizePhone(match[1]);
    if (!normalizedPhone) continue;

    fragments.push(buildTextFragment({
      fragmentKind: 'whatsapp_contact',
      fieldPath: 'contact.references',
      sourceSurface: input.sourceSurface,
      sourceRef: input.sourceRef,
      rawText: match[0],
      normalized: {
        kind: 'whatsapp',
        value: normalizedPhone,
      },
      confidence: 0.9,
      text,
      match,
      metadata: input.metadata,
    }));
  }
}

function appendMediaEvidenceFragments(fragments, input) {
  const media = Array.isArray(input.media) ? input.media : [];

  media.forEach((item, index) => {
    const normalized = compactObject({
      type: normalizeString(item?.type),
      url: normalizeString(item?.url),
      id: normalizeString(item?.id),
      title: normalizeString(item?.title),
      alt: normalizeString(item?.alt),
    });

    if (!Object.keys(normalized).length) return;

    fragments.push({
      fragmentKind: 'media_attachment',
      fieldPath: 'media.attachments',
      sourceSurface: 'media',
      sourceRef: `/media/${index}`,
      rawText: normalized.title || normalized.alt || normalized.url || normalized.id,
      normalized,
      confidence: 0.98,
      metadata: {
        mediaIndex: index,
      },
    });
  });

  const attachmentSummary = isRecord(input.attachmentSummary) ? input.attachmentSummary : null;
  if (!attachmentSummary) return;

  const normalizedSummary = compactObject({
    count: normalizeInteger(attachmentSummary.count),
    types: uniqueStrings(attachmentSummary.types),
    titles: uniqueStrings(attachmentSummary.titles),
    media: Array.isArray(attachmentSummary.media)
      ? attachmentSummary.media.map((item) => compactObject({
        type: normalizeString(item?.type),
        url: normalizeString(item?.url),
        id: normalizeString(item?.id),
        title: normalizeString(item?.title),
      })).filter((item) => Object.keys(item).length)
      : [],
  });

  if (!Object.keys(normalizedSummary).length) return;

  fragments.push({
    fragmentKind: 'media_attachment_summary',
    fieldPath: 'media.attachments',
    sourceSurface: 'media',
    sourceRef: '/payload/attachmentSummary',
    rawText: normalizedSummary.titles?.[0]
      || (normalizedSummary.count ? `${normalizedSummary.count} attachments` : 'attachment summary'),
    normalized: normalizedSummary,
    confidence: 0.78,
    metadata: {},
  });
}

function appendCaptureEvidenceFragments(fragments, observation) {
  const captureMetadata = compactObject({
    captureMethod: normalizeString(observation?.captureMethod),
    captureRunId: normalizeString(observation?.captureRunId),
    capturedAt: normalizeString(observation?.capturedAt),
    rawArtifactPath: normalizeString(observation?.rawArtifactPath),
  });

  if (Object.keys(captureMetadata).length) {
    fragments.push({
      fragmentKind: 'capture_metadata',
      fieldPath: 'provenance.capture',
      sourceSurface: 'capture_metadata',
      sourceRef: '/captureMethod',
      rawText: captureMetadata.captureMethod || captureMetadata.rawArtifactPath || captureMetadata.capturedAt,
      normalized: captureMetadata,
      confidence: 0.95,
      metadata: {},
    });
  }

  const derivedLocation = isRecord(observation?.derivedLocation) ? observation.derivedLocation : null;
  if (!derivedLocation) return;

  const neighborhood = normalizeString(derivedLocation.neighborhood);
  const borough = normalizeString(derivedLocation.borough);

  if (neighborhood) {
    fragments.push({
      fragmentKind: 'capture_derived_neighborhood',
      fieldPath: 'location.neighborhood',
      sourceSurface: 'capture_metadata',
      sourceRef: '/derivedLocation/neighborhood',
      rawText: neighborhood,
      normalized: compactObject({
        neighborhood,
        borough,
      }),
      confidence: 0.68,
      metadata: {},
    });
  }

  if (borough) {
    fragments.push({
      fragmentKind: 'capture_derived_borough',
      fieldPath: 'location.borough',
      sourceSurface: 'capture_metadata',
      sourceRef: '/derivedLocation/borough',
      rawText: borough,
      normalized: {
        borough,
      },
      confidence: 0.68,
      metadata: {},
    });
  }
}

function appendNetworkEvidenceFragments(fragments, observation) {
  const captureHints = isRecord(observation?.captureHints) ? observation.captureHints : {};
  const payload = isRecord(observation?.payload) ? observation.payload : {};
  const networkEnrichment = isRecord(captureHints.networkEnrichment)
    ? captureHints.networkEnrichment
    : (isRecord(payload.captureHints?.networkEnrichment) ? payload.captureHints.networkEnrichment : null);

  if (networkEnrichment) {
    const normalized = compactObject({
      partial: typeof networkEnrichment.partial === 'boolean' ? networkEnrichment.partial : undefined,
      selectedPath: normalizeString(networkEnrichment.selectedPath),
      selectedScore: normalizeNumber(networkEnrichment.selectedScore),
      requestFriendlyName: normalizeString(networkEnrichment.requestFriendlyName),
      requestDocId: normalizeString(networkEnrichment.requestDocId),
      matchScore: normalizeNumber(networkEnrichment.matchScore),
      matchReasons: uniqueStrings(networkEnrichment.matchReasons),
      domHadPostId: typeof networkEnrichment.domHadPostId === 'boolean' ? networkEnrichment.domHadPostId : undefined,
      domHadPostUrl: typeof networkEnrichment.domHadPostUrl === 'boolean' ? networkEnrichment.domHadPostUrl : undefined,
      identityRecovered: typeof networkEnrichment.identityRecovered === 'boolean' ? networkEnrichment.identityRecovered : undefined,
      matchedCaptureId: normalizeString(networkEnrichment.matchedCaptureId),
      matchedCaptureMode: normalizeString(networkEnrichment.matchedCaptureMode),
      matchedRetentionReason: normalizeString(networkEnrichment.matchedRetentionReason),
      matchedStepIndex: normalizeInteger(networkEnrichment.matchedStepIndex),
      matchedPhase: normalizeString(networkEnrichment.matchedPhase),
      mergedAtStepIndex: normalizeInteger(networkEnrichment.mergedAtStepIndex),
    });

    if (Object.keys(normalized).length) {
      fragments.push({
        fragmentKind: 'network_enrichment_metadata',
        fieldPath: 'provenance.networkEnrichment',
        sourceSurface: 'network_enrichment',
        sourceRef: '/captureHints/networkEnrichment',
        rawText: normalized.requestFriendlyName || normalized.matchedCaptureId || normalized.selectedPath || 'network_enrichment',
        normalized,
        confidence: buildNetworkConfidence(networkEnrichment),
        metadata: {},
      });
    }
  }

  const identity = compactObject({
    storyId: normalizeString(payload.storyId),
    feedbackId: normalizeString(payload.feedbackId),
    authorId: normalizeString(payload.authorId),
    authorUrl: normalizeString(payload.authorUrl),
  });

  if (!Object.keys(identity).length) return;

  fragments.push({
    fragmentKind: 'facebook_identity',
    fieldPath: 'provenance.facebookIdentity',
    sourceSurface: networkEnrichment ? 'network_enrichment' : 'capture_metadata',
    sourceRef: '/payload',
    rawText: identity.storyId || identity.feedbackId || identity.authorId || identity.authorUrl,
    normalized: identity,
    confidence: networkEnrichment ? 0.96 : 0.88,
    metadata: {},
  });
}

function buildTextFragment(input) {
  return {
    fragmentKind: input.fragmentKind,
    fieldPath: input.fieldPath,
    sourceSurface: input.sourceSurface,
    sourceRef: input.sourceRef,
    rawText: input.rawText,
    normalized: input.normalized,
    confidence: input.confidence,
    metadata: compactObject({
      ...input.metadata,
      excerpt: buildTextExcerpt(input.text, input.match?.index ?? 0, input.rawText?.length ?? 0),
      matchIndex: normalizeInteger(input.match?.index),
    }),
  };
}

function buildTextExcerpt(text, index, length) {
  const source = String(text || '');
  if (!source) return null;

  const start = Math.max(0, index - 36);
  const end = Math.min(source.length, index + Math.max(length, 1) + 36);
  return source.slice(start, end).trim() || null;
}

function buildNetworkConfidence(networkEnrichment) {
  const matchScore = normalizeNumber(networkEnrichment?.matchScore) || 0;
  const selectedScore = normalizeNumber(networkEnrichment?.selectedScore) || 0;
  return clamp(0.55 + (Math.min(matchScore, 300) / 600) + (Math.min(selectedScore, 150) / 500), 0.55, 0.98);
}

function dedupeFragments(fragments) {
  const seen = new Set();
  const deduped = [];

  for (const fragment of fragments) {
    const key = [
      fragment.fragmentKind,
      fragment.fieldPath,
      fragment.sourceSurface,
      fragment.sourceRef || '',
      fragment.rawText || '',
      stableStringify(fragment.normalized),
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fragment);
  }

  return deduped;
}

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function matchAll(pattern, text) {
  const regexp = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return Array.from(text.matchAll(regexp));
}

function parseMoneyAmount(rawValue) {
  const raw = String(rawValue || '').trim().toLowerCase();
  if (!raw) return null;

  if (raw.endsWith('k')) {
    const amount = Number(raw.slice(0, -1));
    return Number.isFinite(amount) ? Math.round(amount * 1000) : null;
  }

  const numeric = Number(raw.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePricingPeriod(rawValue) {
  const raw = String(rawValue || '').trim().toLowerCase();
  if (!raw) return 'unknown';
  if (raw === 'mo' || raw === 'monthly') return 'month';
  if (raw === 'wk' || raw === 'weekly') return 'week';
  if (raw === 'daily') return 'day';
  return raw;
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

function normalizeHandle(value) {
  const handle = String(value || '').trim();
  if (!handle) return null;
  return handle.startsWith('@') ? handle : `@${handle}`;
}

function isOutboundReferenceUrl(value) {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return false;

  return !normalized.includes('facebook.com/groups/')
    && !normalized.includes('facebook.com/photo/')
    && !normalized.includes('facebook.com/permalink.php')
    && !normalized.includes('facebook.com/share/');
}

function compactObject(value) {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map((value) => normalizeString(value))
      .filter(Boolean),
  ));
}

function normalizeString(value) {
  const normalized = typeof value === 'string' ? value.trim() : String(value || '').trim();
  return normalized || null;
}

function normalizeInteger(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : null;
}

function normalizeNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
