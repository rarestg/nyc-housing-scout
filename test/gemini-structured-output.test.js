import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildGeminiStructuredPrompt,
  findGeminiEnvFile,
  loadEnvFile,
  normalizeGeminiInput,
  parseEnvFile,
  resolveGeminiApiKey,
  runGeminiApiKeyCheck,
  runGeminiStructuredExtraction,
} from '../src/processing/gemini/structured-output-experiment.js';
import {
  GEMINI_CANONICAL_SCHEMA_SOURCE,
  GEMINI_STRUCTURED_OUTPUT_SCHEMA,
  normalizeGeminiStructuredData,
} from '../src/processing/gemini/canonical-schema.js';
import { processObservationWithGemini, resolveGeminiRuntime } from '../src/processing/gemini/processor.js';

test('parseEnvFile reads simple key/value lines', () => {
  const parsed = parseEnvFile(`
# comment
GEMINI_API_KEY=test-key
export GOOGLE_API_KEY="google-key"
INVALID LINE
`);

  assert.deepEqual(parsed, {
    GEMINI_API_KEY: 'test-key',
    GOOGLE_API_KEY: 'google-key',
  });
});

test('loadEnvFile preserves pre-existing env values', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-env-'));
  const envPath = path.join(tempDir, 'gemini.env');

  fs.writeFileSync(envPath, 'GEMINI_API_KEY=file-key\nGOOGLE_API_KEY=file-google-key\n', 'utf8');

  const targetEnv = {
    GEMINI_API_KEY: 'existing-key',
  };
  const result = loadEnvFile(envPath, targetEnv);

  assert.equal(result.path, envPath);
  assert.deepEqual(result.loadedKeys.sort(), ['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
  assert.deepEqual(targetEnv, {
    GEMINI_API_KEY: 'existing-key',
    GOOGLE_API_KEY: 'file-google-key',
  });
});

test('findGeminiEnvFile returns the first existing candidate', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-env-search-'));
  const firstPath = path.join(tempDir, 'data', 'cache', 'gemini', 'gemini.env');
  const secondPath = path.join(tempDir, 'data', 'gemini', 'gemini.env');

  fs.mkdirSync(path.dirname(secondPath), { recursive: true });
  fs.writeFileSync(secondPath, 'GEMINI_API_KEY=second\n', 'utf8');
  fs.mkdirSync(path.dirname(firstPath), { recursive: true });
  fs.writeFileSync(firstPath, 'GEMINI_API_KEY=first\n', 'utf8');

  assert.equal(
    findGeminiEnvFile([
      'data/cache/gemini/gemini.env',
      'data/gemini/gemini.env',
    ], tempDir),
    firstPath,
  );
});

test('normalizeGeminiInput accepts an observation-style input and preserves postUrl', () => {
  const normalized = normalizeGeminiInput({
    id: 'obs_123',
    runId: 'run_123',
    sourceId: 'src_123',
    stablePostId: 'stp_123',
    platformPostId: 'platform_123',
    freshness: 'fresh',
    payload: {
      sourceKey: 'nyc-housing-group',
      groupName: 'NYC Housing Group',
      postUrl: 'https://example.com/posts/123',
      authorName: 'Poster',
      postedAtText: '1h',
      bodyText: 'Room in Bushwick for $1200',
      comments: [{ bodyText: 'Pets okay' }],
      media: [],
    },
  });

  assert.equal(normalized.observation.postUrl, 'https://example.com/posts/123');
  assert.equal(normalized.inputPost, undefined);
  assert.equal(normalized.post.bodyText, 'Room in Bushwick for $1200');
  assert.deepEqual(normalized.post.comments, [{ bodyText: 'Pets okay' }]);
  assert.match(buildGeminiStructuredPrompt(normalized), /https:\/\/example\.com\/posts\/123/u);
});

test('resolveGeminiApiKey prefers GEMINI_API_KEY before GOOGLE_API_KEY', () => {
  assert.deepEqual(
    resolveGeminiApiKey({
      GEMINI_API_KEY: 'gemini-key',
      GOOGLE_API_KEY: 'google-key',
    }),
    {
      envVar: 'GEMINI_API_KEY',
      apiKey: 'gemini-key',
    },
  );
});

test('runGeminiApiKeyCheck uses flash-lite with minimal thinking by default', async () => {
  let capturedRequest = null;
  const fakeClient = {
    models: {
      async generateContent(request) {
        capturedRequest = request;

        return {
          text: 'Hi.',
          responseId: 'resp_key_check',
          modelVersion: 'gemini-3.1-flash-lite-preview-001',
          usageMetadata: {
            promptTokenCount: 3,
            candidatesTokenCount: 2,
            totalTokenCount: 5,
          },
          candidates: [
            {
              finishReason: 'STOP',
            },
          ],
        };
      },
    },
  };

  const result = await runGeminiApiKeyCheck({
    apiKey: 'test-key',
    client: fakeClient,
  });

  assert.equal(capturedRequest.model, 'gemini-3.1-flash-lite-preview');
  assert.equal(capturedRequest.config.temperature, 0);
  assert.equal(capturedRequest.config.thinkingConfig.thinkingLevel, 'minimal');
  assert.match(capturedRequest.contents, /Say hi/u);
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Hi.');
  assert.equal(result.finishReason, 'STOP');
});

test('runGeminiStructuredExtraction returns a processing-style envelope', async () => {
  let capturedRequest = null;
  const fakeClient = {
    models: {
      async generateContent(request) {
        capturedRequest = request;

        return {
          text: JSON.stringify({
            source: {
              postUrl: 'https://example.com/posts/123',
            },
            listings: [
              {
                summary: 'Bushwick room for $1200',
              },
            ],
            overallAmbiguities: [],
          }),
          responseId: 'resp_123',
          modelVersion: 'gemini-3-flash-preview',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 12,
            totalTokenCount: 22,
          },
          candidates: [
            {
              finishReason: 'STOP',
            },
          ],
        };
      },
    },
  };
  const schema = {
    type: 'object',
    properties: {
      source: {
        type: 'object',
      },
      listings: {
        type: 'array',
      },
      overallAmbiguities: {
        type: 'array',
      },
    },
    required: ['source', 'listings', 'overallAmbiguities'],
  };

  const result = await runGeminiStructuredExtraction({
    apiKey: 'test-key',
    client: fakeClient,
    processedAt: '2026-03-13T15:00:00.000Z',
    inputPost: {
      id: 'obs_123',
      payload: {
        sourceKey: 'nyc-housing-group',
        groupName: 'NYC Housing Group',
        postUrl: 'https://example.com/posts/123',
        bodyText: 'Bushwick room for $1200',
      },
    },
    outputSchema: schema,
  });

  assert.equal(capturedRequest.model, 'gemini-3-flash-preview');
  assert.equal(capturedRequest.config.responseMimeType, 'application/json');
  assert.deepEqual(capturedRequest.config.responseJsonSchema, schema);
  assert.equal(capturedRequest.config.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(result.observation.postUrl, 'https://example.com/posts/123');
  assert.equal(result.extracted.listingCount, 1);
  assert.equal(result.extracted.structuredData.listings[0].summary, 'Bushwick room for $1200');
  assert.equal(result.gemini.responseId, 'resp_123');
  assert.equal(result.gemini.finishReason, 'STOP');
  assert.equal(result.gemini.thinkingConfig.thinkingLevel, 'minimal');
  assert.match(result.gemini.prompt, /Bushwick room for \$1200/u);
});

test('normalizeGeminiStructuredData maps canonical structured output into normalized listings', () => {
  const normalizedInput = normalizeGeminiInput({
    id: 'obs_123',
    runId: 'run_123',
    payload: {
      sourceKey: 'nyc-housing-group',
      groupName: 'NYC Housing Group',
      postId: 'post_123',
      postUrl: 'https://example.com/posts/123',
      authorName: 'Poster',
      postedAtText: '1h',
      capturedAt: '2026-03-13T15:00:00.000Z',
      bodyText: 'Private room in Bushwick for $1200/month',
    },
  });

  const normalized = normalizeGeminiStructuredData({
    source: {
      postUrl: 'https://example.com/posts/123',
    },
    listings: [
      {
        postIntent: 'offering',
        listingType: 'room_in_shared',
        location: {
          rawText: 'Bushwick',
          address: null,
          neighborhood: 'Bushwick',
          borough: 'Brooklyn',
          city: 'New York',
          state: 'NY',
          lat: null,
          lng: null,
          geocodeConfidence: null,
        },
        pricing: {
          amount: 1200,
          currency: 'USD',
          period: 'month',
          deposit: null,
          brokerFee: null,
          utilitiesIncluded: true,
        },
        rooms: {
          roomsAvailable: 1,
          totalBedrooms: 3,
          bathrooms: 1,
          occupancyNotes: 'Two roommates already living here',
        },
        dates: {
          availableFrom: '2026-04-01',
          availableTo: null,
          leaseTermText: '12 month lease',
        },
        features: {
          petsAllowed: true,
          laundry: 'in_building',
          furnished: false,
          privateBath: false,
          outdoorSpace: null,
          doorman: false,
          elevator: false,
        },
        contact: {
          contactMethod: 'dm',
          contactValue: null,
        },
        notes: {
          summary: 'Private room in Bushwick for $1200/month',
          rawSignals: ['private room', 'Bushwick', '$1200'],
          ambiguities: ['Deposit amount not mentioned'],
        },
        confidence: {
          overall: 0.82,
          fields: {
            postIntent: 0.95,
            listingType: 0.9,
            location: 0.9,
            borough: 0.95,
            price: 0.92,
            rooms: 0.7,
            dates: 0.76,
          },
        },
      },
    ],
    overallAmbiguities: ['No exact street address'],
  }, normalizedInput);

  assert.equal(normalized.listingCount, 1);
  assert.equal(normalized.structuredData.source.postUrl, 'https://example.com/posts/123');
  assert.equal(normalized.listings[0].source.postUrl, 'https://example.com/posts/123');
  assert.equal(normalized.listings[0].pricing.amount, 1200);
  assert.deepEqual(normalized.listings[0].notes.ambiguities, [
    'Deposit amount not mentioned',
    'No exact street address',
  ]);
});

test('processObservationWithGemini reuses the harness, keeps Gemini 3 thinking minimal by default, and returns normalized listings', async () => {
  let capturedRequest = null;
  const fakeClient = {
    models: {
      async generateContent(request) {
        capturedRequest = request;

        return {
          text: JSON.stringify({
            source: {
              postUrl: 'https://example.com/posts/123',
            },
            listings: [
              {
                postIntent: 'offering',
                listingType: 'room_in_shared',
                location: {
                  rawText: 'Bushwick',
                  address: null,
                  neighborhood: 'Bushwick',
                  borough: 'Brooklyn',
                  city: 'New York',
                  state: 'NY',
                  lat: null,
                  lng: null,
                  geocodeConfidence: null,
                },
                pricing: {
                  amount: 1200,
                  currency: 'USD',
                  period: 'month',
                  deposit: null,
                  brokerFee: null,
                  utilitiesIncluded: null,
                },
                rooms: {
                  roomsAvailable: 1,
                  totalBedrooms: 3,
                  bathrooms: 1,
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
                  contactMethod: 'dm',
                  contactValue: null,
                },
                notes: {
                  summary: 'Private room in Bushwick for $1200/month',
                  rawSignals: ['private room', 'Bushwick', '$1200'],
                  ambiguities: [],
                },
                confidence: {
                  overall: 0.8,
                  fields: {
                    postIntent: 0.9,
                    listingType: 0.9,
                    location: 0.9,
                    borough: 0.9,
                    price: 0.9,
                    rooms: 0.7,
                    dates: 0.3,
                  },
                },
              },
            ],
            overallAmbiguities: [],
          }),
          responseId: 'resp_456',
          modelVersion: 'gemini-3-flash-preview',
          usageMetadata: {
            promptTokenCount: 8,
            candidatesTokenCount: 9,
            totalTokenCount: 17,
          },
          candidates: [
            {
              finishReason: 'STOP',
            },
          ],
        };
      },
    },
  };

  const result = await processObservationWithGemini({
    id: 'obs_123',
    runId: 'run_123',
    payload: {
      sourceKey: 'nyc-housing-group',
      groupName: 'NYC Housing Group',
      postId: 'post_123',
      postUrl: 'https://example.com/posts/123',
      authorName: 'Poster',
      capturedAt: '2026-03-13T15:00:00.000Z',
      bodyText: 'Private room in Bushwick for $1200/month',
    },
  }, {
    apiKey: 'test-key',
    client: fakeClient,
  });

  assert.deepEqual(result.gemini.schemaSource, GEMINI_CANONICAL_SCHEMA_SOURCE);
  assert.deepEqual(result.gemini.schema, GEMINI_STRUCTURED_OUTPUT_SCHEMA);
  assert.equal(capturedRequest.config.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(result.gemini.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(result.extracted.listingCount, 1);
  assert.equal(result.extracted.listings[0].source.postUrl, 'https://example.com/posts/123');
  assert.equal(result.extracted.structuredData.listings[0].notes.summary, 'Private room in Bushwick for $1200/month');
});

test('resolveGeminiRuntime loads an env file when the process env is empty', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-runtime-'));
  const envPath = path.join(tempDir, 'gemini.env');

  fs.writeFileSync(envPath, 'GEMINI_API_KEY=runtime-key\n', 'utf8');

  const result = resolveGeminiRuntime({
    envFile: envPath,
    targetEnv: {},
  });

  assert.equal(result.apiKey, 'runtime-key');
  assert.equal(result.envFile, envPath);
});
