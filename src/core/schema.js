export function createEmptyListing(overrides = {}) {
  const listing = {
    source: {
      platform: 'facebook',
      sourceKey: null,
      groupName: null,
      postUrl: null,
      postId: null,
      authorName: null,
      capturedAt: new Date().toISOString(),
      postedAtText: null,
      captureMethod: null,
      captureRunId: null,
      rawArtifactPath: null,
    },
    postIntent: 'unknown',
    listingType: 'unknown',
    location: {
      rawText: null,
      address: null,
      neighborhood: null,
      borough: null,
      city: 'New York',
      state: 'NY',
      // Downstream-only enrichment fields. First-pass extraction should leave these null.
      // If we add real coordinates later, do it via a reverse-geocode tool / staged
      // enrichment step once address or neighborhood evidence is strong enough.
      lat: null,
      lng: null,
      geocodeConfidence: null,
    },
    pricing: {
      amount: null,
      currency: 'USD',
      period: 'month',
      deposit: null,
      brokerFee: null,
      utilitiesIncluded: null,
    },
    rooms: {
      roomsAvailable: null,
      totalBedrooms: null,
      bathrooms: null,
      occupancyNotes: null,
    },
    dates: {
      availableFrom: null,
      availableTo: null,
      leaseTermText: null,
    },
    features: {
      petsAllowed: null,
      laundry: null,
      furnished: null,
      privateBath: null,
      outdoorSpace: null,
      doorman: null,
      elevator: null,
    },
    contact: {
      contactMethod: null,
      contactValue: null,
    },
    notes: {
      summary: '',
      rawSignals: [],
      ambiguities: [],
    },
    confidence: {
      overall: 0,
      fields: {},
    },
  };

  return {
    ...listing,
    ...overrides,
    source: { ...listing.source, ...overrides.source },
    location: { ...listing.location, ...overrides.location },
    pricing: { ...listing.pricing, ...overrides.pricing },
    rooms: { ...listing.rooms, ...overrides.rooms },
    dates: { ...listing.dates, ...overrides.dates },
    features: { ...listing.features, ...overrides.features },
    contact: { ...listing.contact, ...overrides.contact },
    notes: { ...listing.notes, ...overrides.notes },
    confidence: { ...listing.confidence, ...overrides.confidence },
  };
}
