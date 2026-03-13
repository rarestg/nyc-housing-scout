import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ensureDir } from '../core/file-utils.js';
import {
  buildProcessingDedupeKey,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  resolveProcessingProvenance,
} from '../processing/config.js';

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

export class SqliteStorage {
  constructor({ dbFile, migrationsDir = DEFAULT_MIGRATIONS_DIR }) {
    this.dbFile = dbFile;
    this.migrationsDir = migrationsDir;

    ensureDir(path.dirname(dbFile));
    this.db = new DatabaseSync(dbFile);
    this.configureDatabase();
    this.applyMigrations();
  }

  close() {
    this.db.close();
  }

  getOrCreateSource(input) {
    const now = new Date().toISOString();
    const platform = input.platform || 'facebook';
    const sourceKey = String(input.sourceKey || '').trim();

    if (!sourceKey) {
      throw new Error('storage.getOrCreateSource requires sourceKey');
    }

    return this.withTransaction(() => {
      const existing = this.selectSourceByPlatformAndKey(platform, sourceKey);
      if (existing) {
        const updated = {
          ...existing,
          sourceType: input.sourceType || existing.sourceType || 'unknown',
          displayName: input.displayName ?? existing.displayName ?? null,
          externalUrl: input.externalUrl ?? existing.externalUrl ?? null,
          browserProfile: input.browserProfile ?? existing.browserProfile ?? null,
          active: input.active ?? existing.active ?? true,
          updatedAt: now,
        };

        this.db.prepare(`
          UPDATE sources
          SET source_type = ?, display_name = ?, external_url = ?, browser_profile = ?, active = ?, updated_at = ?
          WHERE id = ?
        `).run(
          updated.sourceType,
          updated.displayName,
          updated.externalUrl,
          updated.browserProfile,
          toSqliteBoolean(updated.active),
          updated.updatedAt,
          updated.id,
        );

        return updated;
      }

      const source = {
        id: this.nextId('source', 'src'),
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

      this.db.prepare(`
        INSERT INTO sources (
          id, platform, source_key, source_type, display_name, external_url, browser_profile, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        source.id,
        source.platform,
        source.sourceKey,
        source.sourceType,
        source.displayName,
        source.externalUrl,
        source.browserProfile,
        toSqliteBoolean(source.active),
        source.createdAt,
        source.updatedAt,
      );

      return source;
    });
  }

  beginRun(input) {
    const now = input.startedAt || new Date().toISOString();
    const runId = String(input.runId || '').trim();

    if (!runId) {
      throw new Error('storage.beginRun requires runId');
    }

    return this.withTransaction(() => {
      if (this.selectRunById(runId)) {
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

      this.db.prepare(`
        INSERT INTO crawl_runs (
          id, source_id, run_kind, status, started_at, finished_at, capture_limit, target_fresh, max_scrolls,
          browser_profile, capture_method, summary_json, collected_export_path, listings_export_path,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        run.sourceId,
        run.runKind,
        run.status,
        run.startedAt,
        run.finishedAt,
        run.captureLimit,
        run.targetFresh,
        run.maxScrolls,
        run.browserProfile,
        run.captureMethod,
        toJson(run.summary),
        run.collectedExportPath,
        run.listingsExportPath,
        toJson(run.metadata, {}),
        run.createdAt,
        run.updatedAt,
      );

      return run;
    });
  }

  recordObservationBatch(input) {
    const now = new Date().toISOString();

    return this.withTransaction(() => {
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
          id: this.nextId('observation', 'obs'),
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

        this.db.prepare(`
          INSERT INTO post_observations (
            id, run_id, step_index, source_id, stable_post_id, platform_post_id, provisional_dedupe_key,
            freshness, identity_confidence, source_key, group_name, post_url, author_name, posted_at_text,
            body_text, comments_json, media_json, capture_method, capture_run_id, captured_at,
            raw_artifact_path, raw_artifact_id, derived_location_json, capture_hints_json, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          observation.id,
          observation.runId,
          observation.stepIndex,
          observation.sourceId,
          observation.stablePostId,
          observation.platformPostId,
          observation.provisionalDedupeKey,
          observation.freshness,
          observation.identityConfidence,
          observation.sourceKey,
          observation.groupName,
          observation.postUrl,
          observation.authorName,
          observation.postedAtText,
          observation.bodyText,
          toJson(observation.comments, []),
          toJson(observation.media, []),
          observation.captureMethod,
          observation.captureRunId,
          observation.capturedAt,
          observation.rawArtifactPath,
          observation.rawArtifactId,
          toJson(observation.derivedLocation),
          toJson(observation.captureHints, {}),
          toJson(observation.payload, {}),
          observation.createdAt,
        );

        if (rawArtifactRef) {
          rawArtifactRef.observationId = observation.id;
          this.db.prepare(`
            UPDATE artifact_refs
            SET observation_id = ?
            WHERE id = ?
          `).run(observation.id, rawArtifactRef.id);
        }

        if (freshnessInfo.stablePost) {
          freshnessInfo.stablePost.latestObservationId = observation.id;
          this.db.prepare(`
            UPDATE stable_posts
            SET latest_observation_id = ?
            WHERE id = ?
          `).run(observation.id, freshnessInfo.stablePost.id);
        }

        results.push({
          observation,
          freshness: freshnessInfo.freshness,
          stablePost: freshnessInfo.stablePost,
          rawArtifactRef,
        });
      }

      this.touchRun(run.id, now);
      return results;
    });
  }

  recordListingsBatch(input) {
    const now = new Date().toISOString();

    return this.withTransaction(() => {
      const run = this.requireRun(input.runId);
      this.requireSource(input.sourceId);
      const records = Array.isArray(input.records) ? input.records : [];
      const created = [];

      for (const record of records) {
        const observation = this.requireObservation(record.observationId);
        const listings = Array.isArray(record.listings) ? record.listings : [];
        created.push(
          ...this.insertListingRecords({
            runId: run.id,
            sourceId: input.sourceId,
            observationId: observation.id,
            listings,
            extractorVersion: input.extractorVersion || null,
            createdAt: now,
          }),
        );
      }

      this.touchRun(run.id, now);
      return created;
    });
  }

  appendRunStep(input) {
    const now = input.recordedAt || new Date().toISOString();

    return this.withTransaction(() => {
      const run = this.requireRun(input.runId);
      this.requireSource(input.sourceId);

      const step = {
        id: this.nextId('runStep', 'step'),
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

      this.db.prepare(`
        INSERT INTO crawl_run_steps (
          id, run_id, source_id, step_index, expanded_count, visible_posts, added_count, fresh_count, seen_count,
          unidentified_count, fresh_collected, seen_collected, unidentified_collected, scroll_y, body_height,
          page_href, page_title, stopped_reason, metadata_json, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        step.id,
        step.runId,
        step.sourceId,
        step.stepIndex,
        step.expandedCount,
        step.visiblePosts,
        step.addedCount,
        step.freshCount,
        step.seenCount,
        step.unidentifiedCount,
        step.freshCollected,
        step.seenCollected,
        step.unidentifiedCollected,
        step.scrollY,
        step.bodyHeight,
        step.pageHref,
        step.pageTitle,
        step.stoppedReason,
        toJson(step.metadata, {}),
        step.recordedAt,
      );

      this.touchRun(run.id, now);
      return step;
    });
  }

  finishRun(input) {
    const now = input.finishedAt || new Date().toISOString();

    return this.withTransaction(() => {
      const existingRun = this.requireRun(input.runId);
      const exports = Array.isArray(input.exports) ? input.exports : [];
      const exportArtifacts = [];
      let collectedExportPath = existingRun.collectedExportPath;
      let listingsExportPath = existingRun.listingsExportPath;

      for (const artifact of exports) {
        const artifactRef = this.createArtifactRef({
          runId: existingRun.id,
          sourceId: existingRun.sourceId,
          observationId: null,
          artifactKind: artifact.artifactKind,
          relativePath: artifact.relativePath,
          sha256: artifact.sha256 ?? null,
          byteSize: artifact.byteSize ?? null,
          createdAt: artifact.createdAt || now,
          metadata: artifact.metadata || {},
        });

        if (artifactRef.artifactKind === 'collected_export') {
          collectedExportPath = artifactRef.relativePath;
        }

        if (artifactRef.artifactKind === 'listing_export') {
          listingsExportPath = artifactRef.relativePath;
        }

        exportArtifacts.push(artifactRef);
      }

      const run = {
        ...existingRun,
        status: input.status || 'completed',
        finishedAt: now,
        summary: input.summary || null,
        collectedExportPath,
        listingsExportPath,
        updatedAt: now,
      };

      this.db.prepare(`
        UPDATE crawl_runs
        SET status = ?, finished_at = ?, summary_json = ?, collected_export_path = ?, listings_export_path = ?, updated_at = ?
        WHERE id = ?
      `).run(
        run.status,
        run.finishedAt,
        toJson(run.summary),
        run.collectedExportPath,
        run.listingsExportPath,
        run.updatedAt,
        run.id,
      );

      return {
        run,
        exportArtifacts,
      };
    });
  }

  enqueueProcessingJobs(input = {}) {
    const now = input.enqueuedAt || new Date().toISOString();
    const provenance = normalizeRequiredProcessingProvenance(input);
    const limit = normalizeLimit(input.limit, 100);
    const maxAttempts = normalizePositiveInteger(input.maxAttempts, DEFAULT_MAX_ATTEMPTS, 100);

    return this.withTransaction(() => {
      const observations = this.selectObservationCandidatesForProcessing({
        ...input,
        limit,
      });
      const results = [];

      for (const observation of observations) {
        if (!observation.postUrl) {
          results.push({
            action: 'skipped_missing_post_url',
            observationId: observation.id,
            sourceId: observation.sourceId,
            sourceKey: observation.sourceKey,
          });
          continue;
        }

        const existing = this.selectProcessingJobByObservationAndProvenance(observation.id, provenance);
        if (existing) {
          results.push({
            action: 'existing',
            job: this.selectProcessingJobSummaryById(existing.id),
          });
          continue;
        }

        const job = {
          id: this.nextId('processingJob', 'job'),
          sourceId: observation.sourceId,
          observationId: observation.id,
          stablePostId: observation.stablePostId ?? null,
          status: 'pending',
          processorVersion: provenance.processorVersion,
          schemaVersion: provenance.schemaVersion,
          modelName: provenance.modelName,
          dedupeKey: buildProcessingDedupeKey({
            observationId: observation.id,
            ...provenance,
          }),
          attemptCount: 0,
          maxAttempts,
          availableAt: input.availableAt || now,
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
          completedAt: null,
          lastError: null,
          lastErrorAt: null,
          createdAt: now,
          updatedAt: now,
        };

        this.db.prepare(`
          INSERT INTO processing_jobs (
            id, source_id, observation_id, stable_post_id, status, processor_version, schema_version, model_name,
            dedupe_key, attempt_count, max_attempts, available_at, claimed_at, claimed_by, lease_expires_at,
            completed_at, last_error, last_error_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          job.id,
          job.sourceId,
          job.observationId,
          job.stablePostId,
          job.status,
          job.processorVersion,
          job.schemaVersion,
          job.modelName,
          job.dedupeKey,
          job.attemptCount,
          job.maxAttempts,
          job.availableAt,
          job.claimedAt,
          job.claimedBy,
          job.leaseExpiresAt,
          job.completedAt,
          job.lastError,
          job.lastErrorAt,
          job.createdAt,
          job.updatedAt,
        );

        results.push({
          action: 'created',
          job: this.selectProcessingJobSummaryById(job.id),
        });
      }

      return {
        enqueuedAt: now,
        provenance,
        counts: summarizeEnqueueResults(results),
        results,
      };
    });
  }

  claimProcessingJobs(input = {}) {
    const now = input.claimedAt || new Date().toISOString();
    const claimedBy = String(input.claimedBy || '').trim();
    const limit = normalizeLimit(input.limit, 10);
    const leaseMs = normalizePositiveInteger(input.leaseMs, DEFAULT_LEASE_MS, 24 * 60 * 60 * 1000);

    if (!claimedBy) {
      throw new Error('storage.claimProcessingJobs requires claimedBy');
    }

    return this.withTransaction(() => {
      this.sweepExpiredProcessingClaims(now);

      const clauses = [
        `j.status IN (${buildPlaceholders(2)})`,
        'j.available_at <= ?',
      ];
      const params = ['pending', 'retryable', now];
      const observationIds = normalizeStringList(input.observationIds || input.observationId);

      if (input.sourceId) {
        clauses.push('j.source_id = ?');
        params.push(input.sourceId);
      }

      if (input.sourceKey) {
        clauses.push('s.source_key = ?');
        params.push(input.sourceKey);
      }

      if (input.runId) {
        clauses.push('o.run_id = ?');
        params.push(input.runId);
      }

      if (input.freshness) {
        clauses.push('o.freshness = ?');
        params.push(input.freshness);
      }

      if (observationIds.length) {
        clauses.push(`j.observation_id IN (${buildPlaceholders(observationIds.length)})`);
        params.push(...observationIds);
      }

      appendOptionalProvenanceFilters(input, clauses, params, 'j');

      const candidates = this.db.prepare(`
        SELECT j.id
        FROM processing_jobs j
        JOIN post_observations o ON o.id = j.observation_id
        JOIN sources s ON s.id = j.source_id
        ${buildWhereClause(clauses)}
        ORDER BY
          CASE j.status
            WHEN 'pending' THEN 0
            WHEN 'retryable' THEN 1
            ELSE 2
          END,
          j.available_at ASC,
          j.created_at ASC,
          j.id ASC
        LIMIT ?
      `).all(...params, limit);

      const leaseExpiresAt = addMillisecondsToIso(now, leaseMs);
      const claimedJobs = [];

      for (const candidate of candidates) {
        this.db.prepare(`
          UPDATE processing_jobs
          SET status = ?, attempt_count = attempt_count + 1, claimed_at = ?, claimed_by = ?, lease_expires_at = ?, updated_at = ?
          WHERE id = ?
        `).run('processing', now, claimedBy, leaseExpiresAt, now, candidate.id);

        claimedJobs.push(this.selectProcessingJobSummaryById(candidate.id, {
          includeObservationPayload: Boolean(input.includeObservationPayload),
        }));
      }

      return claimedJobs;
    });
  }

  completeProcessingJob(input) {
    const now = input.completedAt || new Date().toISOString();
    const jobId = String(input.jobId || '').trim();

    if (!jobId) {
      throw new Error('storage.completeProcessingJob requires jobId');
    }

    if (!input.payload) {
      throw new Error('storage.completeProcessingJob requires payload');
    }

    return this.withTransaction(() => {
      const job = this.requireProcessingJob(jobId);
      if (job.status !== 'processing') {
        throw new Error(`storage.completeProcessingJob requires processing status: ${jobId}`);
      }

      if (input.claimedBy && job.claimedBy !== input.claimedBy) {
        throw new Error(`storage.completeProcessingJob claimant mismatch for ${jobId}`);
      }

      if (this.selectProcessedPayloadByJobId(job.id)) {
        throw new Error(`processed payload already exists for job ${job.id}`);
      }

      const observation = this.requireObservation(job.observationId);
      const postUrl = String(
        input.postUrl
          || input.payload?.observation?.postUrl
          || observation.postUrl
          || '',
      ).trim();

      if (!postUrl) {
        throw new Error(`storage.completeProcessingJob requires postUrl for ${job.id}`);
      }

      const processedPayload = {
        id: this.nextId('processedPayload', 'ppd'),
        jobId: job.id,
        sourceId: job.sourceId,
        observationId: job.observationId,
        stablePostId: job.stablePostId,
        processorVersion: job.processorVersion,
        schemaVersion: job.schemaVersion,
        modelName: job.modelName,
        postUrl,
        listingCount: resolveListingCount(input.payload),
        payload: input.payload,
        createdAt: now,
      };

      this.db.prepare(`
        INSERT INTO processed_payloads (
          id, job_id, source_id, observation_id, stable_post_id, processor_version, schema_version, model_name,
          post_url, listing_count, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        processedPayload.id,
        processedPayload.jobId,
        processedPayload.sourceId,
        processedPayload.observationId,
        processedPayload.stablePostId,
        processedPayload.processorVersion,
        processedPayload.schemaVersion,
        processedPayload.modelName,
        processedPayload.postUrl,
        processedPayload.listingCount,
        toJson(processedPayload.payload, {}),
        processedPayload.createdAt,
      );

      this.insertListingRecords({
        runId: observation.runId,
        sourceId: job.sourceId,
        observationId: observation.id,
        listings: resolveProcessedListings(input.payload),
        extractorVersion: formatProcessingExtractorVersion(job),
        createdAt: now,
      });

      this.db.prepare(`
        UPDATE processing_jobs
        SET status = ?, completed_at = ?, claimed_at = NULL, claimed_by = NULL, lease_expires_at = NULL,
            last_error = NULL, last_error_at = NULL, updated_at = ?
        WHERE id = ?
      `).run('processed', now, now, job.id);

      return this.selectProcessingJobSummaryById(job.id, {
        includeProcessedPayload: Boolean(input.includeProcessedPayload),
      });
    });
  }

  insertListingRecords(input) {
    const listings = Array.isArray(input.listings) ? input.listings : [];
    const created = [];

    listings.forEach((listing, ordinal) => {
      const entry = {
        id: this.nextId('listing', 'lst'),
        runId: input.runId,
        sourceId: input.sourceId,
        observationId: input.observationId,
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
        createdAt: input.createdAt || new Date().toISOString(),
      };

      this.db.prepare(`
        INSERT INTO listing_records (
          id, run_id, source_id, observation_id, ordinal, listing_type, post_intent, borough, neighborhood,
          price_amount, price_period, confidence_overall, extractor_version, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.id,
        entry.runId,
        entry.sourceId,
        entry.observationId,
        entry.ordinal,
        entry.listingType,
        entry.postIntent,
        entry.borough,
        entry.neighborhood,
        entry.priceAmount,
        entry.pricePeriod,
        entry.confidenceOverall,
        entry.extractorVersion,
        toJson(entry.payload, {}),
        entry.createdAt,
      );

      created.push(entry);
    });

    return created;
  }

  failProcessingJob(input) {
    const now = input.failedAt || new Date().toISOString();
    const jobId = String(input.jobId || '').trim();
    const errorMessage = summarizeText(input.errorMessage || input.error || '', 400);
    const retryDelayMs = normalizeNonNegativeInteger(input.retryDelayMs, 0, 24 * 60 * 60 * 1000);

    if (!jobId) {
      throw new Error('storage.failProcessingJob requires jobId');
    }

    if (!errorMessage) {
      throw new Error('storage.failProcessingJob requires errorMessage');
    }

    return this.withTransaction(() => {
      const job = this.requireProcessingJob(jobId);
      if (job.status !== 'processing') {
        throw new Error(`storage.failProcessingJob requires processing status: ${jobId}`);
      }

      if (input.claimedBy && job.claimedBy !== input.claimedBy) {
        throw new Error(`storage.failProcessingJob claimant mismatch for ${jobId}`);
      }

      const retryable = input.retryable === false
        ? false
        : job.attemptCount < job.maxAttempts;
      const nextStatus = retryable ? 'retryable' : 'failed';
      const availableAt = retryable ? addMillisecondsToIso(now, retryDelayMs) : job.availableAt;

      this.db.prepare(`
        UPDATE processing_jobs
        SET status = ?, available_at = ?, claimed_at = NULL, claimed_by = NULL, lease_expires_at = NULL,
            last_error = ?, last_error_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        nextStatus,
        availableAt,
        errorMessage,
        now,
        now,
        job.id,
      );

      return this.selectProcessingJobSummaryById(job.id);
    });
  }

  retryProcessingJobs(input = {}) {
    const now = input.retriedAt || new Date().toISOString();
    const resetAttempts = input.resetAttempts !== false;
    const limit = normalizeLimit(input.limit, 50);

    return this.withTransaction(() => {
      const jobs = this.selectProcessingJobsForRetry({
        ...input,
        limit,
      });
      const retried = [];

      for (const job of jobs) {
        this.db.prepare(`
          UPDATE processing_jobs
          SET status = ?, attempt_count = ?, available_at = ?, claimed_at = NULL, claimed_by = NULL,
              lease_expires_at = NULL, completed_at = NULL, last_error = NULL, last_error_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(
          'pending',
          resetAttempts ? 0 : job.attemptCount,
          input.availableAt || now,
          now,
          job.id,
        );

        retried.push(this.selectProcessingJobSummaryById(job.id));
      }

      return retried;
    });
  }

  listProcessingJobs(input = {}) {
    const limit = normalizeLimit(input.limit, 20);
    const includeObservationPayload = Boolean(input.includeObservationPayload);
    const includeProcessedPayload = Boolean(input.includeProcessedPayload);
    const clauses = [];
    const params = [];
    const jobIds = normalizeStringList(input.jobIds || input.jobId);
    const observationIds = normalizeStringList(input.observationIds || input.observationId);

    if (jobIds.length) {
      clauses.push(`j.id IN (${buildPlaceholders(jobIds.length)})`);
      params.push(...jobIds);
    }

    if (observationIds.length) {
      clauses.push(`j.observation_id IN (${buildPlaceholders(observationIds.length)})`);
      params.push(...observationIds);
    }

    if (input.runId) {
      clauses.push('o.run_id = ?');
      params.push(input.runId);
    }

    if (input.sourceId) {
      clauses.push('j.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.freshness) {
      clauses.push('o.freshness = ?');
      params.push(input.freshness);
    }

    if (input.status) {
      clauses.push('j.status = ?');
      params.push(input.status);
    }

    appendOptionalProvenanceFilters(input, clauses, params, 'j');

    const rows = this.db.prepare(`
      SELECT
        j.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.source_type AS source_type,
        s.display_name AS source_display_name,
        o.run_id AS observation_run_id,
        o.freshness AS observation_freshness,
        o.platform_post_id AS platform_post_id,
        o.post_url AS post_url,
        o.author_name AS author_name,
        o.posted_at_text AS posted_at_text,
        o.captured_at AS observation_captured_at,
        o.payload_json AS observation_payload_json,
        p.id AS processed_payload_id,
        p.post_url AS processed_post_url,
        p.listing_count AS processed_listing_count,
        p.payload_json AS processed_payload_json,
        p.created_at AS processed_created_at
      FROM processing_jobs j
      JOIN post_observations o ON o.id = j.observation_id
      JOIN sources s ON s.id = j.source_id
      LEFT JOIN processed_payloads p ON p.job_id = j.id
      ${buildWhereClause(clauses)}
      ORDER BY j.created_at DESC, j.id DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map((row) => mapProcessingJobSummary(row, {
      includeObservationPayload,
      includeProcessedPayload,
    }));
  }

  summarizeProcessingQueueCoverage(input = {}) {
    const provenance = normalizeRequiredProcessingProvenance(input);
    const sampleLimit = normalizeLimit(input.sampleLimit, 3);
    const observationFilters = buildObservationScopeFilters(input, 'o', 's');
    const hasPostUrlClause = buildNonEmptyTextClause('o.post_url');
    const coverageRow = this.db.prepare(`
      SELECT
        COUNT(*) AS total_observations,
        SUM(CASE WHEN ${hasPostUrlClause} THEN 1 ELSE 0 END) AS eligible_observations,
        SUM(CASE WHEN ${hasPostUrlClause} THEN 0 ELSE 1 END) AS excluded_missing_post_url,
        SUM(CASE WHEN o.freshness = 'fresh' THEN 1 ELSE 0 END) AS fresh_observations,
        SUM(CASE WHEN o.freshness = 'seen' THEN 1 ELSE 0 END) AS seen_observations,
        SUM(CASE WHEN o.freshness = 'unidentified' THEN 1 ELSE 0 END) AS unidentified_observations,
        SUM(CASE WHEN ${hasPostUrlClause} AND j.id IS NOT NULL THEN 1 ELSE 0 END) AS eligible_with_jobs,
        SUM(CASE WHEN ${hasPostUrlClause} AND j.id IS NULL THEN 1 ELSE 0 END) AS eligible_without_jobs,
        COUNT(j.id) AS total_jobs,
        SUM(CASE WHEN j.status = 'pending' THEN 1 ELSE 0 END) AS pending_jobs,
        SUM(CASE WHEN j.status = 'processing' THEN 1 ELSE 0 END) AS processing_jobs,
        SUM(CASE WHEN j.status = 'processed' THEN 1 ELSE 0 END) AS processed_jobs,
        SUM(CASE WHEN j.status = 'retryable' THEN 1 ELSE 0 END) AS retryable_jobs,
        SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs
      FROM post_observations o
      JOIN sources s ON s.id = o.source_id
      LEFT JOIN processing_jobs j
        ON j.observation_id = o.id
        AND j.processor_version = ?
        AND j.schema_version = ?
        AND j.model_name = ?
      ${buildWhereClause(observationFilters.clauses)}
    `).get(
      provenance.processorVersion,
      provenance.schemaVersion,
      provenance.modelName,
      ...observationFilters.params,
    ) || {};

    const missingPostUrlRows = this.db.prepare(`
      SELECT
        o.*,
        s.platform AS source_platform,
        s.source_type AS source_type,
        s.display_name AS source_display_name,
        sp.times_seen AS stable_post_times_seen
      FROM post_observations o
      JOIN sources s ON s.id = o.source_id
      LEFT JOIN stable_posts sp ON sp.id = o.stable_post_id
      ${buildWhereClause([
        ...observationFilters.clauses,
        `${buildEmptyTextClause('o.post_url')}`,
      ])}
      ORDER BY o.captured_at DESC, o.id DESC
      LIMIT ?
    `).all(...observationFilters.params, sampleLimit);

    return {
      provenance,
      observations: {
        totalObservations: Number(coverageRow.total_observations || 0),
        eligibleObservations: Number(coverageRow.eligible_observations || 0),
        excludedMissingPostUrl: Number(coverageRow.excluded_missing_post_url || 0),
        freshness: {
          fresh: Number(coverageRow.fresh_observations || 0),
          seen: Number(coverageRow.seen_observations || 0),
          unidentified: Number(coverageRow.unidentified_observations || 0),
        },
      },
      coverage: {
        eligibleWithJobs: Number(coverageRow.eligible_with_jobs || 0),
        eligibleWithoutJobs: Number(coverageRow.eligible_without_jobs || 0),
      },
      jobs: {
        totalJobs: Number(coverageRow.total_jobs || 0),
        pending: Number(coverageRow.pending_jobs || 0),
        processing: Number(coverageRow.processing_jobs || 0),
        processed: Number(coverageRow.processed_jobs || 0),
        retryable: Number(coverageRow.retryable_jobs || 0),
        failed: Number(coverageRow.failed_jobs || 0),
      },
      missingPostUrlSamples: missingPostUrlRows.map((row) => mapObservationSummary(row, {
        includeFullText: false,
        includeCollections: false,
        includePayload: false,
      })),
    };
  }

  listSources(input = {}) {
    const limit = normalizeLimit(input.limit, 50);
    const clauses = [];
    const params = [];

    if (input.sourceId) {
      clauses.push('s.id = ?');
      params.push(input.sourceId);
    }

    if (input.platform) {
      clauses.push('s.platform = ?');
      params.push(input.platform);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.active === true || input.active === false) {
      clauses.push('s.active = ?');
      params.push(toSqliteBoolean(input.active));
    }

    const rows = this.db.prepare(`
      SELECT
        s.*,
        (
          SELECT COUNT(*)
          FROM crawl_runs r
          WHERE r.source_id = s.id
        ) AS run_count,
        (
          SELECT COUNT(*)
          FROM stable_posts sp
          WHERE sp.source_id = s.id
        ) AS stable_post_count,
        (
          SELECT COUNT(*)
          FROM post_observations o
          WHERE o.source_id = s.id
        ) AS observation_count,
        (
          SELECT COUNT(*)
          FROM listing_records l
          WHERE l.source_id = s.id
        ) AS listing_count,
        (
          SELECT MAX(r.started_at)
          FROM crawl_runs r
          WHERE r.source_id = s.id
        ) AS last_run_started_at
      FROM sources s
      ${buildWhereClause(clauses)}
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map(mapSourceSummary);
  }

  listRecentRuns(input = {}) {
    const limit = normalizeLimit(input.limit, input.runId ? 1 : 10);
    const clauses = [];
    const params = [];

    if (input.runId) {
      clauses.push('r.id = ?');
      params.push(input.runId);
    }

    if (input.sourceId) {
      clauses.push('r.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.platform) {
      clauses.push('s.platform = ?');
      params.push(input.platform);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.status) {
      clauses.push('r.status = ?');
      params.push(input.status);
    }

    if (input.runKind) {
      clauses.push('r.run_kind = ?');
      params.push(input.runKind);
    }

    const rows = this.db.prepare(`
      SELECT
        r.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.source_type AS source_type,
        s.display_name AS source_display_name,
        s.external_url AS source_external_url,
        (
          SELECT COUNT(*)
          FROM post_observations o
          WHERE o.run_id = r.id
        ) AS observation_count,
        (
          SELECT COUNT(*)
          FROM post_observations o
          WHERE o.run_id = r.id AND o.freshness = 'fresh'
        ) AS fresh_observation_count,
        (
          SELECT COUNT(*)
          FROM post_observations o
          WHERE o.run_id = r.id AND o.freshness = 'seen'
        ) AS seen_observation_count,
        (
          SELECT COUNT(*)
          FROM post_observations o
          WHERE o.run_id = r.id AND o.freshness = 'unidentified'
        ) AS unidentified_observation_count,
        (
          SELECT COUNT(*)
          FROM listing_records l
          WHERE l.run_id = r.id
        ) AS listing_count,
        (
          SELECT COUNT(*)
          FROM crawl_run_steps rs
          WHERE rs.run_id = r.id
        ) AS run_step_count,
        (
          SELECT COUNT(*)
          FROM artifact_refs a
          WHERE a.run_id = r.id
        ) AS artifact_count
      FROM crawl_runs r
      JOIN sources s ON s.id = r.source_id
      ${buildWhereClause(clauses)}
      ORDER BY r.started_at DESC, r.id DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map(mapRunSummary);
  }

  listRunSteps(input = {}) {
    const limit = normalizeLimit(input.limit, input.runId ? 200 : 50);
    const clauses = [];
    const params = [];

    if (input.runId) {
      clauses.push('rs.run_id = ?');
      params.push(input.runId);
    }

    if (input.sourceId) {
      clauses.push('rs.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    const orderBy = input.runId
      ? 'ORDER BY rs.step_index ASC, rs.recorded_at ASC, rs.id ASC'
      : 'ORDER BY rs.recorded_at DESC, rs.id DESC';

    const rows = this.db.prepare(`
      SELECT
        rs.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.display_name AS source_display_name,
        r.run_kind AS run_kind,
        r.status AS run_status
      FROM crawl_run_steps rs
      JOIN sources s ON s.id = rs.source_id
      JOIN crawl_runs r ON r.id = rs.run_id
      ${buildWhereClause(clauses)}
      ${orderBy}
      LIMIT ?
    `).all(...params, limit);

    return rows.map(mapRunStepSummary);
  }

  listObservations(input = {}) {
    const limit = normalizeLimit(input.limit, 20);
    const includeFullText = Boolean(input.includeFullText);
    const includeCollections = Boolean(input.includeCollections);
    const includePayload = Boolean(input.includePayload);
    const clauses = [];
    const params = [];

    if (input.runId) {
      clauses.push('o.run_id = ?');
      params.push(input.runId);
    }

    if (input.observationId) {
      clauses.push('o.id = ?');
      params.push(input.observationId);
    }

    if (input.sourceId) {
      clauses.push('o.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.freshness) {
      clauses.push('o.freshness = ?');
      params.push(input.freshness);
    }

    const rows = this.db.prepare(`
      SELECT
        o.*,
        s.platform AS source_platform,
        s.source_type AS source_type,
        s.display_name AS source_display_name,
        sp.times_seen AS stable_post_times_seen
      FROM post_observations o
      JOIN sources s ON s.id = o.source_id
      LEFT JOIN stable_posts sp ON sp.id = o.stable_post_id
      ${buildWhereClause(clauses)}
      ORDER BY o.captured_at DESC, o.id DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map((row) => mapObservationSummary(row, {
      includeFullText,
      includeCollections,
      includePayload,
    }));
  }

  listListings(input = {}) {
    const limit = normalizeLimit(input.limit, 20);
    const includePayload = Boolean(input.includePayload);
    const clauses = [];
    const params = [];

    if (input.runId) {
      clauses.push('l.run_id = ?');
      params.push(input.runId);
    }

    if (input.observationId) {
      clauses.push('l.observation_id = ?');
      params.push(input.observationId);
    }

    if (input.sourceId) {
      clauses.push('l.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.listingType) {
      clauses.push('l.listing_type = ?');
      params.push(input.listingType);
    }

    const rows = this.db.prepare(`
      SELECT
        l.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.source_type AS source_type,
        s.display_name AS source_display_name,
        o.freshness AS observation_freshness,
        o.platform_post_id AS platform_post_id,
        o.post_url AS post_url,
        o.author_name AS author_name,
        o.posted_at_text AS posted_at_text,
        o.captured_at AS observation_captured_at
      FROM listing_records l
      JOIN sources s ON s.id = l.source_id
      JOIN post_observations o ON o.id = l.observation_id
      ${buildWhereClause(clauses)}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map((row) => mapListingSummary(row, { includePayload }));
  }

  listArtifactRefs(input = {}) {
    const limit = normalizeLimit(input.limit, 20);
    const clauses = [];
    const params = [];

    if (input.runId) {
      clauses.push('a.run_id = ?');
      params.push(input.runId);
    }

    if (input.observationId) {
      clauses.push('a.observation_id = ?');
      params.push(input.observationId);
    }

    if (input.sourceId) {
      clauses.push('a.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.artifactKind) {
      clauses.push('a.artifact_kind = ?');
      params.push(input.artifactKind);
    }

    const rows = this.db.prepare(`
      SELECT
        a.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.display_name AS source_display_name,
        o.platform_post_id AS platform_post_id,
        o.freshness AS observation_freshness
      FROM artifact_refs a
      JOIN sources s ON s.id = a.source_id
      LEFT JOIN post_observations o ON o.id = a.observation_id
      ${buildWhereClause(clauses)}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map(mapArtifactRefSummary);
  }

  validateRun(input) {
    const runId = String(input?.runId || '').trim();

    if (!runId) {
      throw new Error('storage.validateRun requires runId');
    }

    const [run] = this.listRecentRuns({ runId, limit: 1 });
    if (!run) {
      throw new Error(`storage run not found: ${runId}`);
    }

    const counts = this.db.prepare(`
      SELECT
        (
          SELECT COUNT(*)
          FROM artifact_refs
          WHERE run_id = ? AND artifact_kind = 'raw_post_payload'
        ) AS raw_artifact_count,
        (
          SELECT COUNT(*)
          FROM artifact_refs
          WHERE run_id = ? AND artifact_kind = 'collected_export'
        ) AS collected_export_count,
        (
          SELECT COUNT(*)
          FROM artifact_refs
          WHERE run_id = ? AND artifact_kind = 'listing_export'
        ) AS listing_export_count,
        (
          SELECT COUNT(*)
          FROM post_observations
          WHERE run_id = ? AND raw_artifact_id IS NULL
        ) AS observations_without_raw_artifact_count,
        (
          SELECT COUNT(*)
          FROM post_observations
          WHERE run_id = ? AND platform_post_id IS NOT NULL
        ) AS identified_observation_count
    `).get(runId, runId, runId, runId, runId);

    const matches = {
      collected: compareExpectedCount(run.summary?.collected, run.observationCount),
      freshCollected: compareExpectedCount(run.summary?.freshCollected, run.freshObservationCount),
      seenCollected: compareExpectedCount(run.summary?.seenCollected, run.seenObservationCount),
      unidentifiedCollected: compareExpectedCount(run.summary?.unidentifiedCollected, run.unidentifiedObservationCount),
      extractedListings: compareExpectedCount(run.summary?.extractedListings, run.listingCount),
      withIds: compareExpectedCount(run.summary?.withIds, counts.identified_observation_count),
    };
    const issues = [];

    if (run.status === 'completed' && !run.finishedAt) {
      issues.push('completed run is missing finishedAt');
    }

    if (run.status === 'completed' && !run.collectedExportPath) {
      issues.push('completed run is missing collectedExportPath');
    }

    if (run.status === 'completed' && !run.listingsExportPath) {
      issues.push('completed run is missing listingsExportPath');
    }

    if (counts.collected_export_count > 1) {
      issues.push(`run has ${counts.collected_export_count} collected_export artifact refs`);
    }

    if (counts.listing_export_count > 1) {
      issues.push(`run has ${counts.listing_export_count} listing_export artifact refs`);
    }

    if (counts.observations_without_raw_artifact_count > 0) {
      issues.push(`${counts.observations_without_raw_artifact_count} observations are missing raw artifact refs`);
    }

    appendMismatchIssue(issues, matches.collected, 'summary.collected does not match observation count');
    appendMismatchIssue(issues, matches.freshCollected, 'summary.freshCollected does not match fresh observation count');
    appendMismatchIssue(issues, matches.seenCollected, 'summary.seenCollected does not match seen observation count');
    appendMismatchIssue(issues, matches.unidentifiedCollected, 'summary.unidentifiedCollected does not match unidentified observation count');
    appendMismatchIssue(issues, matches.extractedListings, 'summary.extractedListings does not match listing count');
    appendMismatchIssue(issues, matches.withIds, 'summary.withIds does not match identified observation count');

    return {
      runId: run.id,
      sourceKey: run.sourceKey,
      runKind: run.runKind,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      summary: run.summary,
      counts: {
        observations: run.observationCount,
        freshObservations: run.freshObservationCount,
        seenObservations: run.seenObservationCount,
        unidentifiedObservations: run.unidentifiedObservationCount,
        listings: run.listingCount,
        runSteps: run.runStepCount,
        artifacts: run.artifactCount,
        rawArtifacts: counts.raw_artifact_count,
        collectedExports: counts.collected_export_count,
        listingExports: counts.listing_export_count,
        identifiedObservations: counts.identified_observation_count,
        observationsWithoutRawArtifacts: counts.observations_without_raw_artifact_count,
      },
      matches,
      issues,
      isHealthy: issues.length === 0,
    };
  }

  requireRun(runId) {
    const run = this.selectRunById(runId);
    if (!run) {
      throw new Error(`storage run not found: ${runId}`);
    }
    return run;
  }

  requireSource(sourceId) {
    const source = this.selectSourceById(sourceId);
    if (!source) {
      throw new Error(`storage source not found: ${sourceId}`);
    }
    return source;
  }

  requireObservation(observationId) {
    const observation = this.selectObservationById(observationId);
    if (!observation) {
      throw new Error(`storage observation not found: ${observationId}`);
    }
    return observation;
  }

  requireProcessingJob(jobId) {
    const job = this.selectProcessingJobById(jobId);
    if (!job) {
      throw new Error(`storage processing job not found: ${jobId}`);
    }
    return job;
  }

  configureDatabase() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
    `);
  }

  applyMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(
      this.db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((row) => row.name),
    );
    const migrations = fs.readdirSync(this.migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const migration of migrations) {
      if (applied.has(migration)) continue;
      const sql = fs.readFileSync(path.join(this.migrationsDir, migration), 'utf8');
      this.withTransaction(() => {
        this.db.exec(sql);
        this.db.prepare(`
          INSERT INTO schema_migrations (name, applied_at)
          VALUES (?, ?)
        `).run(migration, new Date().toISOString());
      });
    }
  }

  createArtifactRef(input) {
    if (!input.relativePath) {
      throw new Error('artifact reference requires relativePath');
    }

    const artifactRef = {
      id: this.nextId('artifact', 'art'),
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

    this.db.prepare(`
      INSERT INTO artifact_refs (
        id, run_id, source_id, observation_id, artifact_kind, relative_path, sha256, byte_size, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifactRef.id,
      artifactRef.runId,
      artifactRef.sourceId,
      artifactRef.observationId,
      artifactRef.artifactKind,
      artifactRef.relativePath,
      artifactRef.sha256,
      artifactRef.byteSize,
      artifactRef.createdAt,
      toJson(artifactRef.metadata, {}),
    );

    return artifactRef;
  }

  classifyAndTouchStablePost(input) {
    if (!input.postId) {
      return { freshness: 'unidentified', stablePost: null };
    }

    const existing = this.selectStablePostBySourceAndPlatformPostId(input.sourceId, input.postId);
    if (existing) {
      const stablePost = {
        ...existing,
        canonicalPostUrl: input.postUrl || existing.canonicalPostUrl || null,
        lastSeenRunId: input.runId,
        lastSeenAt: input.observedAt,
        timesSeen: existing.timesSeen + 1,
      };

      this.db.prepare(`
        UPDATE stable_posts
        SET canonical_post_url = ?, last_seen_run_id = ?, last_seen_at = ?, times_seen = ?
        WHERE id = ?
      `).run(
        stablePost.canonicalPostUrl,
        stablePost.lastSeenRunId,
        stablePost.lastSeenAt,
        stablePost.timesSeen,
        stablePost.id,
      );

      return { freshness: 'seen', stablePost };
    }

    const stablePost = {
      id: this.nextId('stablePost', 'pst'),
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

    this.db.prepare(`
      INSERT INTO stable_posts (
        id, source_id, platform_post_id, canonical_post_url, first_seen_run_id, first_seen_at,
        last_seen_run_id, last_seen_at, times_seen, latest_observation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stablePost.id,
      stablePost.sourceId,
      stablePost.platformPostId,
      stablePost.canonicalPostUrl,
      stablePost.firstSeenRunId,
      stablePost.firstSeenAt,
      stablePost.lastSeenRunId,
      stablePost.lastSeenAt,
      stablePost.timesSeen,
      stablePost.latestObservationId,
    );

    return { freshness: 'fresh', stablePost };
  }

  touchRun(runId, updatedAt) {
    this.db.prepare(`
      UPDATE crawl_runs
      SET updated_at = ?
      WHERE id = ?
    `).run(updatedAt, runId);
  }

  nextId(counterKey, prefix) {
    const current = this.db.prepare(`
      SELECT value
      FROM storage_counters
      WHERE key = ?
    `).get(counterKey);

    const nextValue = current ? current.value + 1 : 1;

    if (current) {
      this.db.prepare(`
        UPDATE storage_counters
        SET value = ?
        WHERE key = ?
      `).run(nextValue, counterKey);
    } else {
      this.db.prepare(`
        INSERT INTO storage_counters (key, value)
        VALUES (?, ?)
      `).run(counterKey, nextValue);
    }

    return `${prefix}_${String(nextValue).padStart(6, '0')}`;
  }

  selectSourceById(sourceId) {
    const row = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
    return mapSource(row);
  }

  selectSourceByPlatformAndKey(platform, sourceKey) {
    const row = this.db.prepare(`
      SELECT *
      FROM sources
      WHERE platform = ? AND source_key = ?
    `).get(platform, sourceKey);

    return mapSource(row);
  }

  selectRunById(runId) {
    const row = this.db.prepare('SELECT * FROM crawl_runs WHERE id = ?').get(runId);
    return mapRun(row);
  }

  selectObservationById(observationId) {
    const row = this.db.prepare('SELECT * FROM post_observations WHERE id = ?').get(observationId);
    return mapObservation(row);
  }

  selectObservationCandidatesForProcessing(input = {}) {
    const limit = normalizeLimit(input.limit, 100);
    const clauses = [];
    const params = [];
    const observationIds = normalizeStringList(input.observationIds || input.observationId);

    if (observationIds.length) {
      clauses.push(`o.id IN (${buildPlaceholders(observationIds.length)})`);
      params.push(...observationIds);
    }

    if (input.runId) {
      clauses.push('o.run_id = ?');
      params.push(input.runId);
    }

    if (input.sourceId) {
      clauses.push('o.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.freshness) {
      clauses.push('o.freshness = ?');
      params.push(input.freshness);
    }

    const rows = this.db.prepare(`
      SELECT
        o.*,
        s.platform AS source_platform,
        s.source_type AS source_type,
        s.display_name AS source_display_name,
        sp.times_seen AS stable_post_times_seen
      FROM post_observations o
      JOIN sources s ON s.id = o.source_id
      LEFT JOIN stable_posts sp ON sp.id = o.stable_post_id
      ${buildWhereClause(clauses)}
      ORDER BY o.captured_at ASC, o.id ASC
      LIMIT ?
    `).all(...params, limit);

    return rows.map((row) => mapObservationSummary(row, {
      includeFullText: true,
      includeCollections: true,
      includePayload: true,
    }));
  }

  selectProcessingJobById(jobId) {
    const row = this.db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(jobId);
    return mapProcessingJob(row);
  }

  selectProcessingJobByObservationAndProvenance(observationId, provenance) {
    const row = this.db.prepare(`
      SELECT *
      FROM processing_jobs
      WHERE observation_id = ? AND processor_version = ? AND schema_version = ? AND model_name = ?
    `).get(
      observationId,
      provenance.processorVersion,
      provenance.schemaVersion,
      provenance.modelName,
    );

    return mapProcessingJob(row);
  }

  selectProcessingJobSummaryById(jobId, options = {}) {
    const rows = this.listProcessingJobs({
      jobId,
      limit: 1,
      includeObservationPayload: options.includeObservationPayload,
      includeProcessedPayload: options.includeProcessedPayload,
    });

    return rows[0] || null;
  }

  selectProcessedPayloadByJobId(jobId) {
    const row = this.db.prepare(`
      SELECT *
      FROM processed_payloads
      WHERE job_id = ?
    `).get(jobId);

    return mapProcessedPayload(row);
  }

  selectStablePostBySourceAndPlatformPostId(sourceId, platformPostId) {
    const row = this.db.prepare(`
      SELECT *
      FROM stable_posts
      WHERE source_id = ? AND platform_post_id = ?
    `).get(sourceId, platformPostId);

    return mapStablePost(row);
  }

  selectProcessingJobsForRetry(input = {}) {
    const limit = normalizeLimit(input.limit, 50);
    const clauses = [];
    const params = [];
    const jobIds = normalizeStringList(input.jobIds || input.jobId);
    const statuses = normalizeStringList(input.status || input.statuses);

    if (jobIds.length) {
      clauses.push(`j.id IN (${buildPlaceholders(jobIds.length)})`);
      params.push(...jobIds);
    }

    if (input.sourceId) {
      clauses.push('j.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.runId) {
      clauses.push('o.run_id = ?');
      params.push(input.runId);
    }

    if (input.freshness) {
      clauses.push('o.freshness = ?');
      params.push(input.freshness);
    }

    if (statuses.length) {
      clauses.push(`j.status IN (${buildPlaceholders(statuses.length)})`);
      params.push(...statuses);
    } else {
      clauses.push(`j.status IN (${buildPlaceholders(2)})`);
      params.push('failed', 'retryable');
    }

    appendOptionalProvenanceFilters(input, clauses, params, 'j');

    const rows = this.db.prepare(`
      SELECT j.*
      FROM processing_jobs j
      JOIN sources s ON s.id = j.source_id
      JOIN post_observations o ON o.id = j.observation_id
      ${buildWhereClause(clauses)}
      ORDER BY j.updated_at ASC, j.id ASC
      LIMIT ?
    `).all(...params, limit);

    return rows.map(mapProcessingJob);
  }

  sweepExpiredProcessingClaims(now) {
    this.db.prepare(`
      UPDATE processing_jobs
      SET status = CASE
            WHEN attempt_count < max_attempts THEN 'retryable'
            ELSE 'failed'
          END,
          available_at = CASE
            WHEN attempt_count < max_attempts THEN ?
            ELSE available_at
          END,
          claimed_at = NULL,
          claimed_by = NULL,
          lease_expires_at = NULL,
          last_error = ?,
          last_error_at = ?,
          updated_at = ?
      WHERE status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
    `).run(
      now,
      'processing lease expired before completion',
      now,
      now,
      now,
    );
  }

  withTransaction(work) {
    this.db.exec('BEGIN IMMEDIATE');

    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures and preserve the original error.
      }
      throw error;
    }
  }
}

function mapSource(row) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    sourceKey: row.source_key,
    sourceType: row.source_type,
    displayName: row.display_name,
    externalUrl: row.external_url,
    browserProfile: row.browser_profile,
    active: fromSqliteBoolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSourceSummary(row) {
  if (!row) return null;

  return {
    ...mapSource(row),
    runCount: row.run_count,
    stablePostCount: row.stable_post_count,
    observationCount: row.observation_count,
    listingCount: row.listing_count,
    lastRunStartedAt: row.last_run_started_at,
  };
}

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    runKind: row.run_kind,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    captureLimit: row.capture_limit,
    targetFresh: row.target_fresh,
    maxScrolls: row.max_scrolls,
    browserProfile: row.browser_profile,
    captureMethod: row.capture_method,
    summary: parseJson(row.summary_json),
    collectedExportPath: row.collected_export_path,
    listingsExportPath: row.listings_export_path,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRunSummary(row) {
  if (!row) return null;

  const run = mapRun(row);
  return {
    ...run,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceType: row.source_type,
    sourceDisplayName: row.source_display_name,
    sourceExternalUrl: row.source_external_url,
    observationCount: row.observation_count,
    freshObservationCount: row.fresh_observation_count,
    seenObservationCount: row.seen_observation_count,
    unidentifiedObservationCount: row.unidentified_observation_count,
    listingCount: row.listing_count,
    runStepCount: row.run_step_count,
    artifactCount: row.artifact_count,
    durationSeconds: computeDurationSeconds(run.startedAt, run.finishedAt),
  };
}

function mapRunStepSummary(row) {
  if (!row) return null;

  return {
    id: row.id,
    runId: row.run_id,
    sourceId: row.source_id,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceDisplayName: row.source_display_name,
    runKind: row.run_kind,
    runStatus: row.run_status,
    stepIndex: row.step_index,
    expandedCount: row.expanded_count,
    visiblePosts: row.visible_posts,
    addedCount: row.added_count,
    freshCount: row.fresh_count,
    seenCount: row.seen_count,
    unidentifiedCount: row.unidentified_count,
    freshCollected: row.fresh_collected,
    seenCollected: row.seen_collected,
    unidentifiedCollected: row.unidentified_collected,
    scrollY: row.scroll_y,
    bodyHeight: row.body_height,
    pageHref: row.page_href,
    pageTitle: row.page_title,
    stoppedReason: row.stopped_reason,
    metadata: parseJson(row.metadata_json, {}),
    recordedAt: row.recorded_at,
  };
}

function mapObservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    stepIndex: row.step_index,
    sourceId: row.source_id,
    stablePostId: row.stable_post_id,
    platformPostId: row.platform_post_id,
    provisionalDedupeKey: row.provisional_dedupe_key,
    freshness: row.freshness,
    identityConfidence: row.identity_confidence,
    sourceKey: row.source_key,
    groupName: row.group_name,
    postUrl: row.post_url,
    authorName: row.author_name,
    postedAtText: row.posted_at_text,
    bodyText: row.body_text,
    comments: parseJson(row.comments_json, []),
    media: parseJson(row.media_json, []),
    captureMethod: row.capture_method,
    captureRunId: row.capture_run_id,
    capturedAt: row.captured_at,
    rawArtifactPath: row.raw_artifact_path,
    rawArtifactId: row.raw_artifact_id,
    derivedLocation: parseJson(row.derived_location_json),
    captureHints: parseJson(row.capture_hints_json, {}),
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function mapObservationSummary(row, options = {}) {
  if (!row) return null;

  const comments = parseJson(row.comments_json, []);
  const media = parseJson(row.media_json, []);
  const observation = {
    id: row.id,
    runId: row.run_id,
    stepIndex: row.step_index,
    sourceId: row.source_id,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceType: row.source_type,
    sourceDisplayName: row.source_display_name,
    stablePostId: row.stable_post_id,
    stablePostTimesSeen: row.stable_post_times_seen ?? null,
    platformPostId: row.platform_post_id,
    provisionalDedupeKey: row.provisional_dedupe_key,
    freshness: row.freshness,
    identityConfidence: row.identity_confidence,
    groupName: row.group_name,
    postUrl: row.post_url,
    authorName: row.author_name,
    postedAtText: row.posted_at_text,
    captureMethod: row.capture_method,
    captureRunId: row.capture_run_id,
    capturedAt: row.captured_at,
    rawArtifactPath: row.raw_artifact_path,
    rawArtifactId: row.raw_artifact_id,
    derivedLocation: parseJson(row.derived_location_json),
    captureHints: parseJson(row.capture_hints_json, {}),
    commentCount: comments.length,
    mediaCount: media.length,
    bodyTextPreview: summarizeText(row.body_text),
    createdAt: row.created_at,
  };

  if (options.includeFullText) {
    observation.bodyText = row.body_text;
  }

  if (options.includeCollections) {
    observation.comments = comments;
    observation.media = media;
  }

  if (options.includePayload) {
    observation.payload = parseJson(row.payload_json, {});
  }

  return observation;
}

function mapStablePost(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    platformPostId: row.platform_post_id,
    canonicalPostUrl: row.canonical_post_url,
    firstSeenRunId: row.first_seen_run_id,
    firstSeenAt: row.first_seen_at,
    lastSeenRunId: row.last_seen_run_id,
    lastSeenAt: row.last_seen_at,
    timesSeen: row.times_seen,
    latestObservationId: row.latest_observation_id,
  };
}

function mapProcessingJob(row) {
  if (!row) return null;

  return {
    id: row.id,
    sourceId: row.source_id,
    observationId: row.observation_id,
    stablePostId: row.stable_post_id,
    status: row.status,
    processorVersion: row.processor_version,
    schemaVersion: row.schema_version,
    modelName: row.model_name,
    dedupeKey: row.dedupe_key,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    leaseExpiresAt: row.lease_expires_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProcessedPayload(row) {
  if (!row) return null;

  return {
    id: row.id,
    jobId: row.job_id,
    sourceId: row.source_id,
    observationId: row.observation_id,
    stablePostId: row.stable_post_id,
    processorVersion: row.processor_version,
    schemaVersion: row.schema_version,
    modelName: row.model_name,
    postUrl: row.post_url,
    listingCount: row.listing_count,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function mapProcessingJobSummary(row, options = {}) {
  if (!row) return null;

  const job = mapProcessingJob(row);
  const summary = {
    ...job,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceType: row.source_type,
    sourceDisplayName: row.source_display_name,
    observationRunId: row.observation_run_id,
    observationFreshness: row.observation_freshness,
    platformPostId: row.platform_post_id,
    postUrl: row.post_url,
    authorName: row.author_name,
    postedAtText: row.posted_at_text,
    capturedAt: row.observation_captured_at,
    processedPayloadId: row.processed_payload_id || null,
    processedListingCount: row.processed_listing_count ?? null,
    processedAt: row.processed_created_at || null,
  };

  if (options.includeObservationPayload) {
    summary.observationPayload = parseJson(row.observation_payload_json, {});
  }

  if (options.includeProcessedPayload && row.processed_payload_json) {
    summary.processedPayload = parseJson(row.processed_payload_json, {});
  }

  return summary;
}

function mapListingSummary(row, options = {}) {
  if (!row) return null;

  const listing = {
    id: row.id,
    runId: row.run_id,
    sourceId: row.source_id,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceType: row.source_type,
    sourceDisplayName: row.source_display_name,
    observationId: row.observation_id,
    observationFreshness: row.observation_freshness,
    platformPostId: row.platform_post_id,
    postUrl: row.post_url,
    authorName: row.author_name,
    postedAtText: row.posted_at_text,
    capturedAt: row.observation_captured_at,
    ordinal: row.ordinal,
    listingType: row.listing_type,
    postIntent: row.post_intent,
    borough: row.borough,
    neighborhood: row.neighborhood,
    priceAmount: row.price_amount,
    pricePeriod: row.price_period,
    confidenceOverall: row.confidence_overall,
    extractorVersion: row.extractor_version,
    createdAt: row.created_at,
  };

  if (options.includePayload) {
    listing.payload = parseJson(row.payload_json, {});
  }

  return listing;
}

function mapArtifactRefSummary(row) {
  if (!row) return null;

  return {
    id: row.id,
    runId: row.run_id,
    sourceId: row.source_id,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceDisplayName: row.source_display_name,
    observationId: row.observation_id,
    platformPostId: row.platform_post_id,
    observationFreshness: row.observation_freshness,
    artifactKind: row.artifact_kind,
    relativePath: row.relative_path,
    sha256: row.sha256,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    metadata: parseJson(row.metadata_json, {}),
  };
}

function summarizeEnqueueResults(results) {
  return results.reduce((summary, result) => {
    summary[result.action] = (summary[result.action] || 0) + 1;
    return summary;
  }, {
    created: 0,
    existing: 0,
    skipped_missing_post_url: 0,
  });
}

function buildWhereClause(clauses) {
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

function buildPlaceholders(count) {
  return new Array(count).fill('?').join(', ');
}

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, 500);
}

function normalizePositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeNonNegativeInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }

  const single = String(value || '').trim();
  return single ? [single] : [];
}

function summarizeText(value, maxLength = 160) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function computeDurationSeconds(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) {
    return null;
  }

  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);

  if (Number.isNaN(started) || Number.isNaN(finished)) {
    return null;
  }

  return Math.max(0, Math.round((finished - started) / 1000));
}

function addMillisecondsToIso(input, milliseconds) {
  const base = Date.parse(input);
  if (Number.isNaN(base)) {
    return new Date(Date.now() + milliseconds).toISOString();
  }

  return new Date(base + milliseconds).toISOString();
}

function compareExpectedCount(expected, actual) {
  if (expected === null || expected === undefined) {
    return null;
  }

  return Number(expected) === Number(actual);
}

function appendMismatchIssue(issues, match, message) {
  if (match === false) {
    issues.push(message);
  }
}

function appendOptionalProvenanceFilters(input, clauses, params, tableAlias) {
  if (input.processorVersion) {
    clauses.push(`${tableAlias}.processor_version = ?`);
    params.push(input.processorVersion);
  }

  if (input.schemaVersion) {
    clauses.push(`${tableAlias}.schema_version = ?`);
    params.push(input.schemaVersion);
  }

  if (input.modelName) {
    clauses.push(`${tableAlias}.model_name = ?`);
    params.push(input.modelName);
  }
}

function normalizeRequiredProcessingProvenance(input) {
  const provenance = resolveProcessingProvenance(input);

  if (!provenance.processorVersion || !provenance.schemaVersion || !provenance.modelName) {
    throw new Error('processing provenance requires processorVersion, schemaVersion, and modelName');
  }

  return provenance;
}

function resolveListingCount(payload) {
  const explicit = payload?.extracted?.listingCount;
  if (Number.isInteger(explicit) && explicit >= 0) {
    return explicit;
  }

  if (Array.isArray(payload?.extracted?.listings)) {
    return payload.extracted.listings.length;
  }

  return 0;
}

function resolveProcessedListings(payload) {
  return Array.isArray(payload?.extracted?.listings)
    ? payload.extracted.listings
    : [];
}

function formatProcessingExtractorVersion(input) {
  return [
    input.processorVersion,
    input.schemaVersion,
    input.modelName,
  ].join('|');
}

function buildObservationScopeFilters(input, observationAlias = 'o', sourceAlias = 's') {
  const clauses = [];
  const params = [];
  const observationIds = normalizeStringList(input.observationIds || input.observationId);

  if (observationIds.length) {
    clauses.push(`${observationAlias}.id IN (${buildPlaceholders(observationIds.length)})`);
    params.push(...observationIds);
  }

  if (input.runId) {
    clauses.push(`${observationAlias}.run_id = ?`);
    params.push(input.runId);
  }

  if (input.sourceId) {
    clauses.push(`${observationAlias}.source_id = ?`);
    params.push(input.sourceId);
  }

  if (input.sourceKey) {
    clauses.push(`${sourceAlias}.source_key = ?`);
    params.push(input.sourceKey);
  }

  if (input.freshness) {
    clauses.push(`${observationAlias}.freshness = ?`);
    params.push(input.freshness);
  }

  return { clauses, params };
}

function buildNonEmptyTextClause(columnName) {
  return `COALESCE(NULLIF(TRIM(${columnName}), ''), '') <> ''`;
}

function buildEmptyTextClause(columnName) {
  return `COALESCE(NULLIF(TRIM(${columnName}), ''), '') = ''`;
}

function toJson(value, fallback = null) {
  const normalized = value === undefined ? fallback : value;
  return normalized === null ? null : JSON.stringify(normalized);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }

  return JSON.parse(value);
}

function toSqliteBoolean(value) {
  return value ? 1 : 0;
}

function fromSqliteBoolean(value) {
  return Boolean(value);
}
