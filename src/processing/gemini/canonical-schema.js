import { createEmptyListing } from '../../core/schema.js';

const BOROUGH_VALUES = Object.freeze([
  'Manhattan',
  'Brooklyn',
  'Queens',
  'Bronx',
  'Staten Island',
]);

const POST_INTENT_VALUES = Object.freeze([
  'offering',
  'wanted',
  'unknown',
]);

const LISTING_TYPE_VALUES = Object.freeze([
  'entire_apartment',
  'room_in_shared',
  'multiple_rooms_in_shared',
  'sublet',
  'lease_takeover',
  'roommate_search',
  'short_term',
  'unknown',
]);

const PRICE_PERIOD_VALUES = Object.freeze([
  'month',
  'week',
  'night',
  'unknown',
]);

const STRING_OR_NULL = Object.freeze({
  type: ['string', 'null'],
});

const NUMBER_OR_NULL = Object.freeze({
  type: ['number', 'null'],
});

const INTEGER_OR_NULL = Object.freeze({
  type: ['integer', 'null'],
});

const BOOLEAN_OR_NULL = Object.freeze({
  type: ['boolean', 'null'],
});

const CONFIDENCE_VALUE_OR_NULL = Object.freeze({
  type: ['number', 'null'],
  minimum: 0,
  maximum: 1,
});

export const GEMINI_STRUCTURED_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    source: {
      type: 'object',
      additionalProperties: false,
      properties: {
        postUrl: {
          type: 'string',
          minLength: 1,
        },
      },
      required: ['postUrl'],
    },
    listings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          postIntent: {
            type: 'string',
            enum: [...POST_INTENT_VALUES],
          },
          listingType: {
            type: 'string',
            enum: [...LISTING_TYPE_VALUES],
          },
          location: {
            type: 'object',
            additionalProperties: false,
            properties: {
              rawText: STRING_OR_NULL,
              address: STRING_OR_NULL,
              neighborhood: STRING_OR_NULL,
              borough: {
                type: ['string', 'null'],
                enum: [...BOROUGH_VALUES, null],
              },
              city: STRING_OR_NULL,
              state: STRING_OR_NULL,
              lat: NUMBER_OR_NULL,
              lng: NUMBER_OR_NULL,
              geocodeConfidence: CONFIDENCE_VALUE_OR_NULL,
            },
            required: [
              'rawText',
              'address',
              'neighborhood',
              'borough',
              'city',
              'state',
              'lat',
              'lng',
              'geocodeConfidence',
            ],
          },
          pricing: {
            type: 'object',
            additionalProperties: false,
            properties: {
              amount: NUMBER_OR_NULL,
              currency: STRING_OR_NULL,
              period: {
                type: 'string',
                enum: [...PRICE_PERIOD_VALUES],
              },
              deposit: NUMBER_OR_NULL,
              brokerFee: BOOLEAN_OR_NULL,
              utilitiesIncluded: BOOLEAN_OR_NULL,
            },
            required: [
              'amount',
              'currency',
              'period',
              'deposit',
              'brokerFee',
              'utilitiesIncluded',
            ],
          },
          rooms: {
            type: 'object',
            additionalProperties: false,
            properties: {
              roomsAvailable: INTEGER_OR_NULL,
              totalBedrooms: NUMBER_OR_NULL,
              bathrooms: NUMBER_OR_NULL,
              occupancyNotes: STRING_OR_NULL,
            },
            required: [
              'roomsAvailable',
              'totalBedrooms',
              'bathrooms',
              'occupancyNotes',
            ],
          },
          dates: {
            type: 'object',
            additionalProperties: false,
            properties: {
              availableFrom: STRING_OR_NULL,
              availableTo: STRING_OR_NULL,
              leaseTermText: STRING_OR_NULL,
            },
            required: [
              'availableFrom',
              'availableTo',
              'leaseTermText',
            ],
          },
          features: {
            type: 'object',
            additionalProperties: false,
            properties: {
              petsAllowed: BOOLEAN_OR_NULL,
              laundry: STRING_OR_NULL,
              furnished: BOOLEAN_OR_NULL,
              privateBath: BOOLEAN_OR_NULL,
              outdoorSpace: BOOLEAN_OR_NULL,
              doorman: BOOLEAN_OR_NULL,
              elevator: BOOLEAN_OR_NULL,
            },
            required: [
              'petsAllowed',
              'laundry',
              'furnished',
              'privateBath',
              'outdoorSpace',
              'doorman',
              'elevator',
            ],
          },
          contact: {
            type: 'object',
            additionalProperties: false,
            properties: {
              contactMethod: STRING_OR_NULL,
              contactValue: STRING_OR_NULL,
            },
            required: [
              'contactMethod',
              'contactValue',
            ],
          },
          notes: {
            type: 'object',
            additionalProperties: false,
            properties: {
              summary: {
                type: 'string',
              },
              rawSignals: {
                type: 'array',
                items: {
                  type: 'string',
                },
              },
              ambiguities: {
                type: 'array',
                items: {
                  type: 'string',
                },
              },
            },
            required: [
              'summary',
              'rawSignals',
              'ambiguities',
            ],
          },
          confidence: {
            type: 'object',
            additionalProperties: false,
            properties: {
              overall: {
                type: 'number',
                minimum: 0,
                maximum: 1,
              },
              fields: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  postIntent: CONFIDENCE_VALUE_OR_NULL,
                  listingType: CONFIDENCE_VALUE_OR_NULL,
                  location: CONFIDENCE_VALUE_OR_NULL,
                  borough: CONFIDENCE_VALUE_OR_NULL,
                  price: CONFIDENCE_VALUE_OR_NULL,
                  rooms: CONFIDENCE_VALUE_OR_NULL,
                  dates: CONFIDENCE_VALUE_OR_NULL,
                },
                required: [
                  'postIntent',
                  'listingType',
                  'location',
                  'borough',
                  'price',
                  'rooms',
                  'dates',
                ],
              },
            },
            required: [
              'overall',
              'fields',
            ],
          },
        },
        required: [
          'postIntent',
          'listingType',
          'location',
          'pricing',
          'rooms',
          'dates',
          'features',
          'contact',
          'notes',
          'confidence',
        ],
      },
    },
    overallAmbiguities: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['source', 'listings', 'overallAmbiguities'],
});

export const GEMINI_CANONICAL_SCHEMA_SOURCE = Object.freeze({
  kind: 'module',
  path: 'src/processing/gemini/canonical-schema.js',
  exportName: 'GEMINI_STRUCTURED_OUTPUT_SCHEMA',
});

export function normalizeGeminiStructuredData(structuredData, normalizedInput) {
  const expectedPostUrl = normalizeNullableString(normalizedInput?.post?.postUrl);
  if (!expectedPostUrl) {
    throw new Error('Gemini structured normalization requires input postUrl');
  }

  const source = normalizeStructuredSource(structuredData?.source, expectedPostUrl);
  const overallAmbiguities = normalizeStringArray(structuredData?.overallAmbiguities);
  const listingsInput = Array.isArray(structuredData?.listings)
    ? structuredData.listings
    : [];
  const listings = listingsInput.map((listing) => normalizeStructuredListing(
    listing,
    normalizedInput?.post,
    overallAmbiguities,
  ));

  return {
    structuredData: {
      source,
      listings: listings.map(stripListingSource),
      overallAmbiguities,
    },
    listings,
    listingCount: listings.length,
  };
}

function normalizeStructuredSource(source, expectedPostUrl) {
  const candidatePostUrl = normalizeNullableString(source?.postUrl);
  if (!candidatePostUrl) {
    throw new Error('Gemini structured output omitted source.postUrl');
  }

  if (candidatePostUrl !== expectedPostUrl) {
    throw new Error(`Gemini structured output changed postUrl provenance: ${candidatePostUrl}`);
  }

  return {
    postUrl: expectedPostUrl,
  };
}

function normalizeStructuredListing(input, post, overallAmbiguities) {
  const listing = createEmptyListing({
    source: buildListingSourceFromPost(post),
  });
  const combinedAmbiguities = uniqueStrings([
    ...normalizeStringArray(input?.notes?.ambiguities),
    ...overallAmbiguities,
  ]);

  listing.postIntent = normalizeEnum(input?.postIntent, POST_INTENT_VALUES, 'unknown');
  listing.listingType = normalizeEnum(input?.listingType, LISTING_TYPE_VALUES, 'unknown');
  listing.location = {
    ...listing.location,
    rawText: normalizeNullableString(input?.location?.rawText),
    address: normalizeNullableString(input?.location?.address),
    neighborhood: normalizeNullableString(input?.location?.neighborhood),
    borough: normalizeNullableEnum(input?.location?.borough, BOROUGH_VALUES),
    city: normalizeNullableString(input?.location?.city) || listing.location.city,
    state: normalizeNullableString(input?.location?.state) || listing.location.state,
    lat: normalizeNullableNumber(input?.location?.lat),
    lng: normalizeNullableNumber(input?.location?.lng),
    geocodeConfidence: normalizeNullableConfidence(input?.location?.geocodeConfidence),
  };
  listing.pricing = {
    ...listing.pricing,
    amount: normalizeNullableNumber(input?.pricing?.amount),
    currency: normalizeNullableString(input?.pricing?.currency) || listing.pricing.currency,
    period: normalizeEnum(input?.pricing?.period, PRICE_PERIOD_VALUES, 'unknown'),
    deposit: normalizeNullableNumber(input?.pricing?.deposit),
    brokerFee: normalizeNullableBoolean(input?.pricing?.brokerFee),
    utilitiesIncluded: normalizeNullableBoolean(input?.pricing?.utilitiesIncluded),
  };
  listing.rooms = {
    ...listing.rooms,
    roomsAvailable: normalizeNullableInteger(input?.rooms?.roomsAvailable),
    totalBedrooms: normalizeNullableNumber(input?.rooms?.totalBedrooms),
    bathrooms: normalizeNullableNumber(input?.rooms?.bathrooms),
    occupancyNotes: normalizeNullableString(input?.rooms?.occupancyNotes),
  };
  listing.dates = {
    ...listing.dates,
    availableFrom: normalizeNullableString(input?.dates?.availableFrom),
    availableTo: normalizeNullableString(input?.dates?.availableTo),
    leaseTermText: normalizeNullableString(input?.dates?.leaseTermText),
  };
  listing.features = {
    ...listing.features,
    petsAllowed: normalizeNullableBoolean(input?.features?.petsAllowed),
    laundry: normalizeNullableString(input?.features?.laundry),
    furnished: normalizeNullableBoolean(input?.features?.furnished),
    privateBath: normalizeNullableBoolean(input?.features?.privateBath),
    outdoorSpace: normalizeNullableBoolean(input?.features?.outdoorSpace),
    doorman: normalizeNullableBoolean(input?.features?.doorman),
    elevator: normalizeNullableBoolean(input?.features?.elevator),
  };
  listing.contact = {
    ...listing.contact,
    contactMethod: normalizeNullableString(input?.contact?.contactMethod),
    contactValue: normalizeNullableString(input?.contact?.contactValue),
  };
  listing.notes = {
    summary: normalizeString(input?.notes?.summary),
    rawSignals: normalizeStringArray(input?.notes?.rawSignals),
    ambiguities: combinedAmbiguities,
  };
  listing.confidence = {
    overall: normalizeConfidence(input?.confidence?.overall),
    fields: compactObject({
      postIntent: normalizeNullableConfidence(input?.confidence?.fields?.postIntent),
      listingType: normalizeNullableConfidence(input?.confidence?.fields?.listingType),
      location: normalizeNullableConfidence(input?.confidence?.fields?.location),
      borough: normalizeNullableConfidence(input?.confidence?.fields?.borough),
      price: normalizeNullableConfidence(input?.confidence?.fields?.price),
      rooms: normalizeNullableConfidence(input?.confidence?.fields?.rooms),
      dates: normalizeNullableConfidence(input?.confidence?.fields?.dates),
    }),
  };

  return listing;
}

function stripListingSource(listing) {
  return {
    postIntent: listing.postIntent,
    listingType: listing.listingType,
    location: { ...listing.location },
    pricing: { ...listing.pricing },
    rooms: { ...listing.rooms },
    dates: { ...listing.dates },
    features: { ...listing.features },
    contact: { ...listing.contact },
    notes: {
      summary: listing.notes.summary,
      rawSignals: [...listing.notes.rawSignals],
      ambiguities: [...listing.notes.ambiguities],
    },
    confidence: {
      overall: listing.confidence.overall,
      fields: {
        postIntent: listing.confidence.fields.postIntent ?? null,
        listingType: listing.confidence.fields.listingType ?? null,
        location: listing.confidence.fields.location ?? null,
        borough: listing.confidence.fields.borough ?? null,
        price: listing.confidence.fields.price ?? null,
        rooms: listing.confidence.fields.rooms ?? null,
        dates: listing.confidence.fields.dates ?? null,
      },
    },
  };
}

function buildListingSourceFromPost(post) {
  return {
    platform: 'facebook',
    sourceKey: normalizeNullableString(post?.sourceKey),
    groupName: normalizeNullableString(post?.groupName),
    postUrl: normalizeNullableString(post?.postUrl),
    postId: normalizeNullableString(post?.postId),
    authorName: normalizeNullableString(post?.authorName),
    capturedAt: normalizeNullableString(post?.capturedAt) || new Date().toISOString(),
    postedAtText: normalizeNullableString(post?.postedAtText),
    captureMethod: normalizeNullableString(post?.captureMethod),
    captureRunId: normalizeNullableString(post?.captureRunId),
    rawArtifactPath: normalizeNullableString(post?.rawArtifactPath),
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  );
}

function uniqueStrings(values) {
  return Array.from(new Set(normalizeStringArray(values)));
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeString(value))
    .filter(Boolean);
}

function normalizeEnum(value, allowedValues, fallback) {
  const normalized = normalizeString(value);
  return allowedValues.includes(normalized)
    ? normalized
    : fallback;
}

function normalizeNullableEnum(value, allowedValues) {
  const normalized = normalizeString(value);
  return allowedValues.includes(normalized)
    ? normalized
    : null;
}

function normalizeConfidence(value) {
  return normalizeNullableConfidence(value) ?? 0;
}

function normalizeNullableConfidence(value) {
  const numericValue = normalizeNullableNumber(value);
  if (numericValue === null) {
    return null;
  }

  return Math.max(0, Math.min(1, numericValue));
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? numericValue
    : null;
}

function normalizeNullableInteger(value) {
  const numericValue = normalizeNullableNumber(value);
  return Number.isInteger(numericValue)
    ? numericValue
    : null;
}

function normalizeNullableBoolean(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return null;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}
