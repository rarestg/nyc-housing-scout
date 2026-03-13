import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeJsonFile } from '../core/file-utils.js';

const STORAGE_VERSION = 1;

function createEmptyState() {
  return {
    version: STORAGE_VERSION,
    ids: {
      source: 0,
      artifact: 0,
      stablePost: 0,
      observation: 0,
      listing: 0,
      runStep: 0,
    },
    sources: [],
    runs: [],
    runSteps: [],
    artifactRefs: [],
    stablePosts: [],
    observations: [],
    listings: [],
  };
}

export class FileStorage {
  constructor({ stateFile }) {
    this.stateFile = stateFile;
    ensureDir(path.dirname(stateFile));
    this.state = loadState(stateFile);
  }

  getOrCreateSource(input) {
    const now = new Date().toISOString();
    const platform = input.platform || 'facebook';
    const sourceKey = String(input.sourceKey || '').trim();

    if (!sourceKey) {
      throw new Error('storage.getOrCreateSource requires sourceKey');
    }

    const existing = this.state.sources.find((source) => source.platform === platform && source.sourceKey === sourceKey);
    if (existing) {
      existing.sourceType = input.sourceType || existing.sourceType || 'unknown';
      existing.displayName = input.displayName ?? existing.displayName ?? null;
      existing.externalUrl = input.externalUrl ?? existing.externalUrl ?? null;
      existing.browserProfile = input.browserProfile ?? existing.browserProfile ?? null;
      existing.active = input.active ?? existing.active ?? true;
      existing.updatedAt = now;
      this.persist();
      return clone(existing);
    }

    const source = {
      id: allocateId(this.state, 'source', 'src'),
      platform,
      sourceKey,
      sourceType: input.sourceType || 'unknown',
      displayName: input.displayName ?? null,
      externalUrl: input.externalUrl ?? null,
      browserProfile: input.browserProfile ?? null,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.state.sources.push(source);
    this.persist();
    return clone(source);
  }

  beginRun(input) {
    const now = input.startedAt || new Date().toISOString();
    const runId = String(input.runId || '').trim();

    if (!runId) {
      throw new Error('storage.beginRun requires runId');
    }

    if (this.state.runs.some((run) => run.id === runId)) {
      throw new Error(`storage.beginRun received duplicate runId: ${runId}`);
    }

    this.requireSource(input.sourceId);

    const run = {
      id: runId,
      sourceId: input.sourceId,
      runKind: input.runKind || 'crawl',
      status: input.status || 'running',
      startedAt: now,
      finishedAt: null,
      captureLimit: input.captureLimit ?? null,
      targetFresh: input.targetFresh ?? null,
      maxScrolls: input.maxScrolls ?? null,
      browserProfile: input.browserProfile ?? null,
      captureMethod: input.captureMethod ?? null,
      summary: null,
      collectedExportPath: null,
      listingsExportPath: null,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    this.state.runs.push(run);
    this.persist();
    return clone(run);
  }

  recordObservationBatch(input) {
    const now = new Date().toISOString();
    const run = this.requireRun(input.runId);
    const source = this.requireSource(input.sourceId);
    const stepIndex = Number.isInteger(input.stepIndex) ? input.stepIndex : null;
    const entries = Array.isArray(input.entries) ? input.entries : [];
    const results = [];

    for (const entry of entries) {
      const post = entry.post;
      if (!post) continue;

      const rawArtifactRef = entry.rawArtifact
        ? this.createArtifactRef({
            runId: run.id,
            sourceId: source.id,
            observationId: null,
            artifactKind: entry.rawArtifact.artifactKind || 'raw_post_payload',
            relativePath: entry.rawArtifact.relativePath,
            sha256: entry.rawArtifact.sha256 ?? null,
            byteSize: entry.rawArtifact.byteSize ?? null,
            createdAt: entry.rawArtifact.createdAt || post.capturedAt || now,
            metadata: entry.rawArtifact.metadata || {},
          })
        : null;

      const freshnessInfo = this.classifyAndTouchStablePost({
        sourceId: source.id,
        postId: post.postId,
        postUrl: post.postUrl,
        runId: run.id,
        observedAt: post.capturedAt || now,
      });

      const observation = {
        id: allocateId(this.state, 'observation', 'obs'),
        runId: run.id,
        stepIndex,
        sourceId: source.id,
        stablePostId: freshnessInfo.stablePost?.id ?? null,
        platformPostId: post.postId || null,
        provisionalDedupeKey: post.dedupeKey || null,
        freshness: freshnessInfo.freshness,
        identityConfidence: post.postId ? 'stable' : 'provisional',
        sourceKey: post.sourceKey || source.sourceKey,
        groupName: post.groupName || source.displayName || null,
        postUrl: post.postUrl || null,
        authorName: post.authorName || null,
        postedAtText: post.postedAtText || null,
        bodyText: post.bodyText || '',
        comments: Array.isArray(post.comments) ? post.comments : [],
        media: Array.isArray(post.media) ? post.media : [],
        captureMethod: post.captureMethod || run.captureMethod || null,
        captureRunId: post.captureRunId || run.id,
        capturedAt: post.capturedAt || now,
        rawArtifactPath: post.rawArtifactPath || rawArtifactRef?.relativePath || null,
        rawArtifactId: rawArtifactRef?.id ?? null,
        derivedLocation: post.derivedLocation || null,
        captureHints: post.captureHints || {},
        payload: post,
        createdAt: now,
      };

      if (rawArtifactRef) {
        rawArtifactRef.observationId = observation.id;
      }

      if (freshnessInfo.stablePost) {
        freshnessInfo.stablePost.latestObservationId = observation.id;
      }

      this.state.observations.push(observation);
      results.push({
        observation: clone(observation),
        freshness: freshnessInfo.freshness,
        stablePost: freshnessInfo.stablePost ? clone(freshnessInfo.stablePost) : null,
        rawArtifactRef: rawArtifactRef ? clone(rawArtifactRef) : null,
      });
    }

    run.updatedAt = now;
    this.persist();
    return results;
  }

  recordListingsBatch(input) {
    const now = new Date().toISOString();
    const run = this.requireRun(input.runId);
    this.requireSource(input.sourceId);
    const records = Array.isArray(input.records) ? input.records : [];
    const created = [];

    for (const record of records) {
      const observation = this.requireObservation(record.observationId);
      const listings = Array.isArray(record.listings) ? record.listings : [];

      listings.forEach((listing, ordinal) => {
        const entry = {
          id: allocateId(this.state, 'listing', 'lst'),
          runId: run.id,
          sourceId: input.sourceId,
          observationId: observation.id,
          ordinal,
          listingType: listing?.listingType || 'unknown',
          postIntent: listing?.postIntent || null,
          borough: listing?.location?.borough || null,
          neighborhood: listing?.location?.neighborhood || null,
          priceAmount: listing?.pricing?.amount ?? null,
          pricePeriod: listing?.pricing?.period || null,
          confidenceOverall: listing?.confidence?.overall ?? 0,
          extractorVersion: input.extractorVersion || null,
          payload: listing,
          createdAt: now,
        };

        this.state.listings.push(entry);
        created.push(clone(entry));
      });
    }

    run.updatedAt = now;
    this.persist();
    return created;
  }

  appendRunStep(input) {
    const now = input.recordedAt || new Date().toISOString();
    const run = this.requireRun(input.runId);
    this.requireSource(input.sourceId);

    const step = {
      id: allocateId(this.state, 'runStep', 'step'),
      runId: run.id,
      sourceId: input.sourceId,
      stepIndex: Number.isInteger(input.stepIndex) ? input.stepIndex : null,
      expandedCount: input.expandedCount ?? null,
      visiblePosts: input.visiblePosts ?? null,
      addedCount: input.addedCount ?? null,
      freshCount: input.freshCount ?? null,
      seenCount: input.seenCount ?? null,
      unidentifiedCount: input.unidentifiedCount ?? null,
      freshCollected: input.freshCollected ?? null,
      seenCollected: input.seenCollected ?? null,
      unidentifiedCollected: input.unidentifiedCollected ?? null,
      scrollY: input.scrollY ?? null,
      bodyHeight: input.bodyHeight ?? null,
      pageHref: input.pageHref ?? null,
      pageTitle: input.pageTitle ?? null,
      stoppedReason: input.stoppedReason ?? null,
      metadata: input.metadata || {},
      recordedAt: now,
    };

    this.state.runSteps.push(step);
    run.updatedAt = now;
    this.persist();
    return clone(step);
  }

  finishRun(input) {
    const now = input.finishedAt || new Date().toISOString();
    const run = this.requireRun(input.runId);
    const exports = Array.isArray(input.exports) ? input.exports : [];
    const exportArtifacts = [];

    for (const artifact of exports) {
      const artifactRef = this.createArtifactRef({
        runId: run.id,
        sourceId: run.sourceId,
        observationId: null,
        artifactKind: artifact.artifactKind,
        relativePath: artifact.relativePath,
        sha256: artifact.sha256 ?? null,
        byteSize: artifact.byteSize ?? null,
        createdAt: artifact.createdAt || now,
        metadata: artifact.metadata || {},
      });

      if (artifactRef.artifactKind === 'collected_export') {
        run.collectedExportPath = artifactRef.relativePath;
      }

      if (artifactRef.artifactKind === 'listing_export') {
        run.listingsExportPath = artifactRef.relativePath;
      }

      exportArtifacts.push(clone(artifactRef));
    }

    run.status = input.status || 'completed';
    run.finishedAt = now;
    run.summary = input.summary || null;
    run.updatedAt = now;
    this.persist();

    return {
      run: clone(run),
      exportArtifacts,
    };
  }

  persist() {
    writeJsonFile(this.stateFile, this.state);
  }

  requireRun(runId) {
    const run = this.state.runs.find((entry) => entry.id === runId);
    if (!run) {
      throw new Error(`storage run not found: ${runId}`);
    }
    return run;
  }

  requireSource(sourceId) {
    const source = this.state.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error(`storage source not found: ${sourceId}`);
    }
    return source;
  }

  requireObservation(observationId) {
    const observation = this.state.observations.find((entry) => entry.id === observationId);
    if (!observation) {
      throw new Error(`storage observation not found: ${observationId}`);
    }
    return observation;
  }

  createArtifactRef(input) {
    if (!input.relativePath) {
      throw new Error('artifact reference requires relativePath');
    }

    const artifactRef = {
      id: allocateId(this.state, 'artifact', 'art'),
      runId: input.runId,
      sourceId: input.sourceId,
      observationId: input.observationId ?? null,
      artifactKind: input.artifactKind || 'unknown',
      relativePath: input.relativePath,
      sha256: input.sha256 ?? null,
      byteSize: input.byteSize ?? null,
      createdAt: input.createdAt || new Date().toISOString(),
      metadata: input.metadata || {},
    };

    this.state.artifactRefs.push(artifactRef);
    return artifactRef;
  }

  classifyAndTouchStablePost(input) {
    if (!input.postId) {
      return { freshness: 'unidentified', stablePost: null };
    }

    const existing = this.state.stablePosts.find((entry) => entry.sourceId === input.sourceId && entry.platformPostId === input.postId);
    if (existing) {
      existing.canonicalPostUrl = input.postUrl || existing.canonicalPostUrl || null;
      existing.lastSeenRunId = input.runId;
      existing.lastSeenAt = input.observedAt;
      existing.timesSeen += 1;
      return { freshness: 'seen', stablePost: existing };
    }

    const stablePost = {
      id: allocateId(this.state, 'stablePost', 'pst'),
      sourceId: input.sourceId,
      platformPostId: input.postId,
      canonicalPostUrl: input.postUrl || null,
      firstSeenRunId: input.runId,
      firstSeenAt: input.observedAt,
      lastSeenRunId: input.runId,
      lastSeenAt: input.observedAt,
      timesSeen: 1,
      latestObservationId: null,
    };

    this.state.stablePosts.push(stablePost);
    return { freshness: 'fresh', stablePost };
  }
}

function allocateId(state, key, prefix) {
  state.ids[key] += 1;
  return `${prefix}_${String(state.ids[key]).padStart(6, '0')}`;
}

function loadState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return createEmptyState();
  }

  const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  return {
    ...createEmptyState(),
    ...parsed,
    ids: {
      ...createEmptyState().ids,
      ...(parsed.ids || {}),
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
