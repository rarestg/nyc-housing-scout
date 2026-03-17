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
const DEFAULT_DASHBOARD_PAGE_SIZE = 50;
const MAX_DASHBOARD_PAGE_SIZE = 100;
const DEFAULT_DASHBOARD_LOW_CONFIDENCE_THRESHOLD = 0.75;

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

  recordEvidenceFragments(input = {}) {
    const defaultCreatedAt = input.createdAt || new Date().toISOString();

    return this.withTransaction(() => {
      const entries = Array.isArray(input.entries) ? input.entries : [];
      const created = [];

      for (const entry of entries) {
        const observation = this.requireObservation(entry.observationId);
        const fragments = Array.isArray(entry.fragments) ? entry.fragments : [];

        for (const fragment of fragments) {
          const fragmentKind = String(fragment.fragmentKind || '').trim();
          const fieldPath = String(fragment.fieldPath || '').trim();
          const sourceSurface = String(fragment.sourceSurface || '').trim();
          const producerKind = String(fragment.producerKind || '').trim();
          const producerVersion = String(fragment.producerVersion || '').trim();

          if (!fragmentKind) {
            throw new Error('storage.recordEvidenceFragments requires fragmentKind');
          }

          if (!fieldPath) {
            throw new Error('storage.recordEvidenceFragments requires fieldPath');
          }

          if (!sourceSurface) {
            throw new Error('storage.recordEvidenceFragments requires sourceSurface');
          }

          if (!producerKind) {
            throw new Error('storage.recordEvidenceFragments requires producerKind');
          }

          if (!producerVersion) {
            throw new Error('storage.recordEvidenceFragments requires producerVersion');
          }

          const evidenceFragment = {
            id: this.nextId('evidenceFragment', 'efg'),
            sourceId: observation.sourceId,
            observationId: observation.id,
            stablePostId: observation.stablePostId ?? null,
            runId: observation.runId,
            fragmentKind,
            fieldPath,
            sourceSurface,
            sourceRef: normalizeNullableText(fragment.sourceRef),
            producerKind,
            producerVersion,
            rawText: fragment.rawText ?? null,
            normalized: fragment.normalized === undefined ? null : fragment.normalized,
            confidence: normalizeNullableNumber(fragment.confidence),
            metadata: fragment.metadata || {},
            createdAt: fragment.createdAt || defaultCreatedAt,
          };

          this.db.prepare(`
            INSERT INTO evidence_fragments (
              id, source_id, observation_id, stable_post_id, run_id, fragment_kind, field_path, source_surface,
              source_ref, producer_kind, producer_version, raw_text, normalized_json, confidence, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            evidenceFragment.id,
            evidenceFragment.sourceId,
            evidenceFragment.observationId,
            evidenceFragment.stablePostId,
            evidenceFragment.runId,
            evidenceFragment.fragmentKind,
            evidenceFragment.fieldPath,
            evidenceFragment.sourceSurface,
            evidenceFragment.sourceRef,
            evidenceFragment.producerKind,
            evidenceFragment.producerVersion,
            evidenceFragment.rawText,
            toJson(evidenceFragment.normalized),
            evidenceFragment.confidence,
            toJson(evidenceFragment.metadata, {}),
            evidenceFragment.createdAt,
          );

          created.push(evidenceFragment);
        }
      }

      return created;
    });
  }

  upsertResolvedField(input) {
    const now = input.updatedAt || new Date().toISOString();
    const target = this.resolveTargetScope(input);
    const fieldPath = String(input.fieldPath || '').trim();
    const status = String(input.status || '').trim();
    const resolutionKind = String(input.resolutionKind || '').trim();
    const resolverVersion = String(input.resolverVersion || '').trim();

    if (!fieldPath) {
      throw new Error('storage.upsertResolvedField requires fieldPath');
    }

    if (!status) {
      throw new Error('storage.upsertResolvedField requires status');
    }

    if (!resolutionKind) {
      throw new Error('storage.upsertResolvedField requires resolutionKind');
    }

    if (!resolverVersion) {
      throw new Error('storage.upsertResolvedField requires resolverVersion');
    }

    return this.withTransaction(() => {
      const existing = this.selectResolvedFieldByTargetField(target.targetKind, target.targetId, fieldPath);
      const supportingFragmentIds = normalizeStringList(input.supportingFragmentIds);

      if (existing) {
        this.db.prepare(`
          UPDATE resolved_fields
          SET source_id = ?, observation_id = ?, status = ?, resolution_kind = ?, resolver_version = ?, value_json = ?,
              confidence = ?, ambiguity_json = ?, supporting_fragment_ids_json = ?, metadata_json = ?, updated_at = ?
          WHERE id = ?
        `).run(
          target.sourceId,
          target.observationId,
          status,
          resolutionKind,
          resolverVersion,
          toJson(input.value),
          normalizeNullableNumber(input.confidence),
          toJson(input.ambiguity),
          toJson(supportingFragmentIds, []),
          toJson(input.metadata || {}, {}),
          now,
          existing.id,
        );

        return this.selectResolvedFieldByTargetField(target.targetKind, target.targetId, fieldPath);
      }

      const createdAt = input.createdAt || now;
      const resolvedField = {
        id: this.nextId('resolvedField', 'rfd'),
        targetKind: target.targetKind,
        targetId: target.targetId,
        sourceId: target.sourceId,
        observationId: target.observationId,
        fieldPath,
        status,
        resolutionKind,
        resolverVersion,
        value: input.value,
        confidence: normalizeNullableNumber(input.confidence),
        ambiguity: input.ambiguity,
        supportingFragmentIds,
        metadata: input.metadata || {},
        createdAt,
        updatedAt: now,
      };

      this.db.prepare(`
        INSERT INTO resolved_fields (
          id, target_kind, target_id, source_id, observation_id, field_path, status, resolution_kind,
          resolver_version, value_json, confidence, ambiguity_json, supporting_fragment_ids_json, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        resolvedField.id,
        resolvedField.targetKind,
        resolvedField.targetId,
        resolvedField.sourceId,
        resolvedField.observationId,
        resolvedField.fieldPath,
        resolvedField.status,
        resolvedField.resolutionKind,
        resolvedField.resolverVersion,
        toJson(resolvedField.value),
        resolvedField.confidence,
        toJson(resolvedField.ambiguity),
        toJson(resolvedField.supportingFragmentIds, []),
        toJson(resolvedField.metadata, {}),
        resolvedField.createdAt,
        resolvedField.updatedAt,
      );

      return resolvedField;
    });
  }

  setManualOverride(input) {
    return this.withTransaction(() => this.writeManualOverrideRecord(input));
  }

  clearManualOverride(input) {
    return this.withTransaction(() => this.writeClearedManualOverrideRecord(input));
  }

  appendAuditEvent(input) {
    return this.withTransaction(() => this.writeAuditEventRecord(input));
  }

  applyManualOverrideAction(input = {}) {
    const action = normalizeManualOverrideAction(input.action);
    const targetKind = String(input.targetKind || '').trim();
    const targetId = String(input.targetId || '').trim();
    const fieldPath = String(input.fieldPath || '').trim();

    if (!targetKind) {
      throw new Error('storage.applyManualOverrideAction requires targetKind');
    }

    if (!targetId) {
      throw new Error('storage.applyManualOverrideAction requires targetId');
    }

    if (!fieldPath) {
      throw new Error('storage.applyManualOverrideAction requires fieldPath');
    }

    if (action === 'set' && !hasManualOverrideValue(input.value)) {
      throw new Error('storage.applyManualOverrideAction requires value for set actions');
    }

    return this.withTransaction(() => {
      const target = this.resolveTargetScope({ ...input, targetKind, targetId });
      const previousManualOverride = this.selectManualOverrideByTargetField(targetKind, targetId, fieldPath);
      const nextMetadata = {
        surface: 'review',
        ...(isPlainObject(input.metadata) ? input.metadata : {}),
      };

      if (normalizeNullableText(input.reviewId)) {
        nextMetadata.reviewId = normalizeNullableText(input.reviewId);
      }

      let manualOverride = null;
      let eventKind = 'manual_override_set';
      let outcome = 'created';

      if (action === 'clear') {
        manualOverride = this.writeClearedManualOverrideRecord({
          ...input,
          targetKind,
          targetId,
          fieldPath,
          metadata: nextMetadata,
          resolvedTargetScope: target,
        });
        eventKind = 'manual_override_cleared';
        outcome = 'cleared';
      } else {
        manualOverride = this.writeManualOverrideRecord({
          ...input,
          targetKind,
          targetId,
          fieldPath,
          metadata: nextMetadata,
          resolvedTargetScope: target,
        });
        if (isActiveManualOverride(previousManualOverride)) {
          eventKind = 'manual_override_updated';
          outcome = 'updated';
        }
      }

      const auditEvent = this.writeAuditEventRecord({
        ...input,
        targetKind,
        targetId,
        actorKind: input.actorKind || 'operator',
        actorId: normalizeNullableText(input.actorId) ?? normalizeNullableText(input.operatorId),
        eventKind,
        payload: buildManualOverrideAuditPayload({
          action: outcome,
          fieldPath,
          reviewId: normalizeNullableText(input.reviewId),
          reason: normalizeNullableText(input.reason),
          previousManualOverride,
          manualOverride,
        }),
        resolvedTargetScope: target,
      });

      return {
        action: outcome,
        targetKind,
        targetId,
        fieldPath,
        previousManualOverride,
        manualOverride,
        auditEvent,
      };
    });
  }

  writeManualOverrideRecord(input) {
    const now = input.updatedAt || new Date().toISOString();
    const target = input.resolvedTargetScope || this.resolveTargetScope(input);
    const fieldPath = String(input.fieldPath || '').trim();

    if (!fieldPath) {
      throw new Error('storage.setManualOverride requires fieldPath');
    }

    const existing = this.selectManualOverrideByTargetField(target.targetKind, target.targetId, fieldPath);
    const nextOperatorId = normalizeNullableText(input.operatorId);
    const nextReason = normalizeNullableText(input.reason);
    const nextMetadata = input.metadata || {};

    if (existing) {
      this.db.prepare(`
        UPDATE manual_overrides
        SET source_id = ?, observation_id = ?, value_json = ?, reason = ?, operator_id = ?, status = ?,
            metadata_json = ?, updated_at = ?, cleared_at = NULL
        WHERE id = ?
      `).run(
        target.sourceId,
        target.observationId,
        toJson(input.value),
        nextReason,
        nextOperatorId,
        'active',
        toJson(nextMetadata, {}),
        now,
        existing.id,
      );

      return this.selectManualOverrideByTargetField(target.targetKind, target.targetId, fieldPath);
    }

    const createdAt = input.createdAt || now;
    const manualOverride = {
      id: this.nextId('manualOverride', 'mno'),
      targetKind: target.targetKind,
      targetId: target.targetId,
      sourceId: target.sourceId,
      observationId: target.observationId,
      fieldPath,
      value: input.value,
      reason: nextReason,
      operatorId: nextOperatorId,
      status: 'active',
      metadata: nextMetadata,
      createdAt,
      updatedAt: now,
      clearedAt: null,
    };

    this.db.prepare(`
      INSERT INTO manual_overrides (
        id, target_kind, target_id, source_id, observation_id, field_path, value_json, reason, operator_id,
        status, metadata_json, created_at, updated_at, cleared_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      manualOverride.id,
      manualOverride.targetKind,
      manualOverride.targetId,
      manualOverride.sourceId,
      manualOverride.observationId,
      manualOverride.fieldPath,
      toJson(manualOverride.value),
      manualOverride.reason,
      manualOverride.operatorId,
      manualOverride.status,
      toJson(manualOverride.metadata, {}),
      manualOverride.createdAt,
      manualOverride.updatedAt,
      manualOverride.clearedAt,
    );

    return manualOverride;
  }

  writeClearedManualOverrideRecord(input) {
    const now = input.clearedAt || input.updatedAt || new Date().toISOString();
    const target = input.resolvedTargetScope || this.resolveTargetScope(input);
    const fieldPath = String(input.fieldPath || '').trim();

    if (!fieldPath) {
      throw new Error('storage.clearManualOverride requires fieldPath');
    }

    const existing = this.selectManualOverrideByTargetField(target.targetKind, target.targetId, fieldPath);
    if (!existing) {
      throw new Error(`storage manual override not found: ${target.targetKind}:${target.targetId}:${fieldPath}`);
    }

    this.db.prepare(`
      UPDATE manual_overrides
      SET source_id = ?, observation_id = ?, reason = ?, operator_id = ?, status = ?, metadata_json = ?,
          updated_at = ?, cleared_at = ?
      WHERE id = ?
    `).run(
      target.sourceId,
      target.observationId,
      normalizeNullableText(input.reason) ?? existing.reason ?? null,
      normalizeNullableText(input.operatorId) ?? existing.operatorId ?? null,
      String(input.status || 'cleared').trim() || 'cleared',
      toJson(input.metadata ?? existing.metadata ?? {}, {}),
      now,
      now,
      existing.id,
    );

    return this.selectManualOverrideByTargetField(target.targetKind, target.targetId, fieldPath);
  }

  writeAuditEventRecord(input) {
    const now = input.createdAt || new Date().toISOString();
    const target = input.resolvedTargetScope || this.resolveTargetScope(input);
    const eventKind = String(input.eventKind || '').trim();
    const actorKind = String(input.actorKind || '').trim();

    if (!eventKind) {
      throw new Error('storage.appendAuditEvent requires eventKind');
    }

    if (!actorKind) {
      throw new Error('storage.appendAuditEvent requires actorKind');
    }

    const auditEvent = {
      id: this.nextId('auditEvent', 'evt'),
      targetKind: target.targetKind,
      targetId: target.targetId,
      sourceId: target.sourceId,
      observationId: target.observationId,
      eventKind,
      actorKind,
      actorId: normalizeNullableText(input.actorId),
      payload: input.payload || {},
      createdAt: now,
    };

    this.db.prepare(`
      INSERT INTO audit_events (
        id, target_kind, target_id, source_id, observation_id, event_kind, actor_kind, actor_id, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditEvent.id,
      auditEvent.targetKind,
      auditEvent.targetId,
      auditEvent.sourceId,
      auditEvent.observationId,
      auditEvent.eventKind,
      auditEvent.actorKind,
      auditEvent.actorId,
      toJson(auditEvent.payload, {}),
      auditEvent.createdAt,
    );

    return auditEvent;
  }

  getEffectiveFieldValue(input = {}) {
    const targetKind = String(input.targetKind || '').trim();
    const targetId = String(input.targetId || '').trim();
    const fieldPath = String(input.fieldPath || '').trim();

    if (!targetKind) {
      throw new Error('storage.getEffectiveFieldValue requires targetKind');
    }

    if (!targetId) {
      throw new Error('storage.getEffectiveFieldValue requires targetId');
    }

    if (!fieldPath) {
      throw new Error('storage.getEffectiveFieldValue requires fieldPath');
    }

    const manualOverride = this.selectManualOverrideByTargetField(targetKind, targetId, fieldPath);
    const resolvedField = this.selectResolvedFieldByTargetField(targetKind, targetId, fieldPath);

    return resolveEffectiveFieldValue({
      targetKind,
      targetId,
      fieldPath,
      manualOverride,
      resolvedField,
      rawExtractedValue: input.rawExtractedValue,
      rawExtractedSource: input.rawExtractedSource || 'listing_record',
      rawObservationValue: input.rawObservationValue,
      rawObservationSource: input.rawObservationSource || 'observation',
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
      const excludeJobIds = normalizeStringList(input.excludeJobIds || input.excludeJobId);

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

      if (excludeJobIds.length) {
        clauses.push(`j.id NOT IN (${buildPlaceholders(excludeJobIds.length)})`);
        params.push(...excludeJobIds);
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

  listEvidenceFragments(input = {}) {
    const limit = normalizeLimit(input.limit, 50);
    const clauses = [];
    const params = [];
    const fragmentIds = normalizeStringList(input.fragmentIds || input.fragmentId);

    if (fragmentIds.length) {
      clauses.push(`f.id IN (${buildPlaceholders(fragmentIds.length)})`);
      params.push(...fragmentIds);
    }

    if (input.runId) {
      clauses.push('f.run_id = ?');
      params.push(input.runId);
    }

    if (input.observationId) {
      clauses.push('f.observation_id = ?');
      params.push(input.observationId);
    }

    if (input.stablePostId) {
      clauses.push('f.stable_post_id = ?');
      params.push(input.stablePostId);
    }

    if (input.sourceId) {
      clauses.push('f.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.fieldPath) {
      clauses.push('f.field_path = ?');
      params.push(input.fieldPath);
    }

    if (input.fragmentKind) {
      clauses.push('f.fragment_kind = ?');
      params.push(input.fragmentKind);
    }

    if (input.sourceSurface) {
      clauses.push('f.source_surface = ?');
      params.push(input.sourceSurface);
    }

    if (input.producerKind) {
      clauses.push('f.producer_kind = ?');
      params.push(input.producerKind);
    }

    if (input.producerVersion) {
      clauses.push('f.producer_version = ?');
      params.push(input.producerVersion);
    }

    const rows = this.db.prepare(`
      SELECT
        f.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.display_name AS source_display_name
      FROM evidence_fragments f
      JOIN sources s ON s.id = f.source_id
      ${buildWhereClause(clauses)}
      ORDER BY f.created_at ASC, f.id ASC
      LIMIT ?
    `).all(...params, limit);

    return rows.map(mapEvidenceFragment);
  }

  listResolvedFields(input = {}) {
    const limit = normalizeLimit(input.limit, 50);
    const clauses = [];
    const params = [];
    const resolvedFieldIds = normalizeStringList(input.resolvedFieldIds || input.resolvedFieldId);
    const targetIds = normalizeStringList(input.targetIds || input.targetId);
    const fieldPaths = normalizeStringList(input.fieldPaths || input.fieldPath);

    if (resolvedFieldIds.length) {
      clauses.push(`rf.id IN (${buildPlaceholders(resolvedFieldIds.length)})`);
      params.push(...resolvedFieldIds);
    }

    if (input.targetKind) {
      clauses.push('rf.target_kind = ?');
      params.push(input.targetKind);
    }

    if (targetIds.length) {
      clauses.push(`rf.target_id IN (${buildPlaceholders(targetIds.length)})`);
      params.push(...targetIds);
    }

    if (input.observationId) {
      clauses.push('rf.observation_id = ?');
      params.push(input.observationId);
    }

    if (input.runId) {
      clauses.push('o.run_id = ?');
      params.push(input.runId);
    }

    if (input.sourceId) {
      clauses.push('rf.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (fieldPaths.length) {
      clauses.push(`rf.field_path IN (${buildPlaceholders(fieldPaths.length)})`);
      params.push(...fieldPaths);
    }

    if (input.status) {
      clauses.push('rf.status = ?');
      params.push(input.status);
    }

    if (input.resolutionKind) {
      clauses.push('rf.resolution_kind = ?');
      params.push(input.resolutionKind);
    }

    if (input.resolverVersion) {
      clauses.push('rf.resolver_version = ?');
      params.push(input.resolverVersion);
    }

    const rows = this.db.prepare(`
      SELECT
        rf.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.display_name AS source_display_name,
        o.run_id AS run_id,
        o.stable_post_id AS stable_post_id
      FROM resolved_fields rf
      JOIN sources s ON s.id = rf.source_id
      JOIN post_observations o ON o.id = rf.observation_id
      ${buildWhereClause(clauses)}
      ORDER BY rf.updated_at DESC, rf.id DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map(mapResolvedField);
  }

  listManualOverrides(input = {}) {
    const limit = normalizeLimit(input.limit, 50);
    const clauses = [];
    const params = [];
    const manualOverrideIds = normalizeStringList(input.manualOverrideIds || input.manualOverrideId);
    const targetIds = normalizeStringList(input.targetIds || input.targetId);
    const fieldPaths = normalizeStringList(input.fieldPaths || input.fieldPath);

    if (manualOverrideIds.length) {
      clauses.push(`mo.id IN (${buildPlaceholders(manualOverrideIds.length)})`);
      params.push(...manualOverrideIds);
    }

    if (input.targetKind) {
      clauses.push('mo.target_kind = ?');
      params.push(input.targetKind);
    }

    if (targetIds.length) {
      clauses.push(`mo.target_id IN (${buildPlaceholders(targetIds.length)})`);
      params.push(...targetIds);
    }

    if (input.observationId) {
      clauses.push('mo.observation_id = ?');
      params.push(input.observationId);
    }

    if (input.runId) {
      clauses.push('o.run_id = ?');
      params.push(input.runId);
    }

    if (input.sourceId) {
      clauses.push('mo.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (fieldPaths.length) {
      clauses.push(`mo.field_path IN (${buildPlaceholders(fieldPaths.length)})`);
      params.push(...fieldPaths);
    }

    if (input.status) {
      clauses.push('mo.status = ?');
      params.push(input.status);
    }

    const rows = this.db.prepare(`
      SELECT
        mo.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.display_name AS source_display_name,
        o.run_id AS run_id,
        o.stable_post_id AS stable_post_id
      FROM manual_overrides mo
      JOIN sources s ON s.id = mo.source_id
      JOIN post_observations o ON o.id = mo.observation_id
      ${buildWhereClause(clauses)}
      ORDER BY mo.updated_at DESC, mo.id DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map(mapManualOverride);
  }

  listAuditEvents(input = {}) {
    const limit = normalizeLimit(input.limit, 100);
    const clauses = [];
    const params = [];
    const auditEventIds = normalizeStringList(input.auditEventIds || input.auditEventId);

    if (auditEventIds.length) {
      clauses.push(`ae.id IN (${buildPlaceholders(auditEventIds.length)})`);
      params.push(...auditEventIds);
    }

    if (input.targetKind) {
      clauses.push('ae.target_kind = ?');
      params.push(input.targetKind);
    }

    if (input.targetId) {
      clauses.push('ae.target_id = ?');
      params.push(input.targetId);
    }

    if (input.observationId) {
      clauses.push('ae.observation_id = ?');
      params.push(input.observationId);
    }

    if (input.runId) {
      clauses.push('o.run_id = ?');
      params.push(input.runId);
    }

    if (input.sourceId) {
      clauses.push('ae.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

    if (input.eventKind) {
      clauses.push('ae.event_kind = ?');
      params.push(input.eventKind);
    }

    if (input.actorKind) {
      clauses.push('ae.actor_kind = ?');
      params.push(input.actorKind);
    }

    const rows = this.db.prepare(`
      SELECT
        ae.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.display_name AS source_display_name,
        o.run_id AS run_id,
        o.stable_post_id AS stable_post_id
      FROM audit_events ae
      JOIN sources s ON s.id = ae.source_id
      JOIN post_observations o ON o.id = ae.observation_id
      ${buildWhereClause(clauses)}
      ORDER BY ae.created_at DESC, ae.id DESC
      LIMIT ?
    `).all(...params, limit);

    return rows.map(mapAuditEvent);
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

  selectDashboardListingCandidates(input = {}) {
    const clauses = [];
    const params = [];

    if (input.listingId) {
      clauses.push('l.id = ?');
      params.push(input.listingId);
    }

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

    if (input.intent) {
      clauses.push('l.post_intent = ?');
      params.push(input.intent);
    }

    if (input.freshness) {
      clauses.push('o.freshness = ?');
      params.push(input.freshness);
    }

    const rows = this.db.prepare(`
      SELECT
        l.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.source_type AS source_type,
        s.display_name AS source_display_name,
        o.stable_post_id AS stable_post_id,
        o.freshness AS observation_freshness,
        o.platform_post_id AS platform_post_id,
        o.post_url AS post_url,
        o.author_name AS author_name,
        o.posted_at_text AS posted_at_text,
        o.body_text AS observation_body_text,
        o.captured_at AS observation_captured_at,
        o.derived_location_json AS observation_derived_location_json,
        o.raw_artifact_path AS observation_raw_artifact_path,
        o.raw_artifact_id AS observation_raw_artifact_id,
        sp.times_seen AS stable_post_times_seen
      FROM listing_records l
      JOIN sources s ON s.id = l.source_id
      JOIN post_observations o ON o.id = l.observation_id
      LEFT JOIN stable_posts sp ON sp.id = o.stable_post_id
      ${buildWhereClause(clauses)}
      ORDER BY o.captured_at DESC, l.created_at DESC, l.id DESC
    `).all(...params);

    return this.attachDashboardListingFieldStates(rows.map(mapDashboardListingCandidate));
  }

  attachDashboardListingFieldStates(listings = []) {
    if (!Array.isArray(listings) || listings.length === 0) {
      return [];
    }

    const targetIds = uniqueStrings(listings.map((listing) => listing.listingId));
    const fieldPaths = DASHBOARD_LOCATION_FIELD_DEFINITIONS.map((definition) => definition.fieldPath);
    const resolvedByKey = new Map(
      this.selectResolvedFieldsByTargets('listing_record', targetIds, fieldPaths)
        .map((row) => [buildTargetFieldKey(row.targetId, row.fieldPath), row]),
    );
    const manualByKey = new Map(
      this.selectManualOverridesByTargets('listing_record', targetIds, fieldPaths)
        .map((row) => [buildTargetFieldKey(row.targetId, row.fieldPath), row]),
    );

    return listings.map((listing) => {
      const locationFieldStates = DASHBOARD_LOCATION_FIELD_DEFINITIONS.map((definition) => (
        buildDashboardFieldState({
          fieldDefinition: definition,
          listing,
          manualOverride: manualByKey.get(buildTargetFieldKey(listing.listingId, definition.fieldPath)) || null,
          resolvedField: resolvedByKey.get(buildTargetFieldKey(listing.listingId, definition.fieldPath)) || null,
        })
      ));
      const fieldStateByPath = indexDashboardFieldStates(locationFieldStates);

      return applyDashboardListingFieldStates(listing, fieldStateByPath);
    });
  }

  listDashboardListings(input = {}) {
    const page = normalizeDashboardPage(input.page, 1);
    const pageSize = normalizeDashboardPageSize(input.pageSize, DEFAULT_DASHBOARD_PAGE_SIZE);
    const sort = normalizeDashboardSort(input.sort, [
      'newest',
      'oldest',
      'price-asc',
      'price-desc',
      'confidence-desc',
      'confidence-asc',
    ], 'newest');
    const now = input.now || new Date().toISOString();
    const normalized = {
      borough: normalizeQueryText(input.borough),
      neighborhood: normalizeQueryText(input.neighborhood),
      q: normalizeQueryText(input.q),
      priceMin: normalizeNullableNumber(input.priceMin),
      priceMax: normalizeNullableNumber(input.priceMax),
      bedsMin: normalizeNullableNumber(input.bedsMin),
      bedsMax: normalizeNullableNumber(input.bedsMax),
      bathsMin: normalizeNullableNumber(input.bathsMin),
      postedWithinHours: normalizeNullableNumber(input.postedWithinHours),
      minConfidence: normalizeNullableNumber(input.minConfidence),
      hasAmbiguities: normalizeOptionalBoolean(input.hasAmbiguities),
    };

    const primaryListings = collapseDashboardListingVariants(this.selectDashboardListingCandidates(input));
    const filtered = primaryListings.filter((listing) => matchesDashboardListingFilters(listing, normalized, now));
    const sorted = filtered.slice().sort((left, right) => compareDashboardListingRows(left, right, sort));
    const paginated = paginateDashboardItems(sorted, page, pageSize);

    return buildDashboardListResponse({
      items: paginated.map(toDashboardListingListItem),
      page,
      pageSize,
      totalItems: filtered.length,
      sort,
      filters: buildDashboardFilters({
        q: normalized.q,
        sourceKey: input.sourceKey,
        freshness: input.freshness,
        listingType: input.listingType,
        intent: input.intent,
        borough: input.borough,
        neighborhood: input.neighborhood,
        priceMin: normalized.priceMin,
        priceMax: normalized.priceMax,
        bedsMin: normalized.bedsMin,
        bedsMax: normalized.bedsMax,
        bathsMin: normalized.bathsMin,
        postedWithinHours: normalized.postedWithinHours,
        minConfidence: normalized.minConfidence,
        hasAmbiguities: normalized.hasAmbiguities,
        runId: input.runId,
      }),
    });
  }

  getDashboardListingDetail(input = {}) {
    const listingId = String(input.listingId || '').trim();

    if (!listingId) {
      throw new Error('storage.getDashboardListingDetail requires listingId');
    }

    const [selectedVariant] = this.selectDashboardListingCandidates({ listingId });
    if (!selectedVariant) {
      return null;
    }

    const variants = this.selectDashboardListingCandidates({
      observationId: selectedVariant.observationId,
    }).filter((candidate) => candidate.ordinal === selectedVariant.ordinal);
    const [primaryListing] = collapseDashboardListingVariants(variants);
    const [observation] = this.listObservations({
      observationId: selectedVariant.observationId,
      includeFullText: true,
      includeCollections: true,
      includePayload: true,
      limit: 1,
    });
    const [run] = this.listRecentRuns({ runId: selectedVariant.runId, limit: 1 });
    const [source] = this.listSources({ sourceId: selectedVariant.sourceId, limit: 1 });
    const jobs = this.listProcessingJobs({
      observationId: selectedVariant.observationId,
      limit: 500,
      includeProcessedPayload: true,
    }).map(toDashboardJobDetailItem);
    const artifacts = this.listArtifactRefs({
      observationId: selectedVariant.observationId,
      limit: 500,
    });

    return {
      listing: buildDashboardListingDetailItem(primaryListing),
      selectedVariantId: selectedVariant.listingId,
      selectedVariant: buildDashboardListingVariantDetailItem(selectedVariant),
      variants: variants
        .slice()
        .sort(compareDashboardListingVariantPriority)
        .map(buildDashboardListingVariantDetailItem),
      observation: buildDashboardObservationDetailItem(observation),
      source,
      run,
      provenance: {
        listingId: primaryListing.listingId,
        observationId: selectedVariant.observationId,
        runId: selectedVariant.runId,
        sourceId: selectedVariant.sourceId,
        stablePostId: selectedVariant.stablePostId,
        rawArtifactId: selectedVariant.rawArtifactId,
        rawArtifactPath: selectedVariant.rawArtifactPath,
        variantCount: primaryListing.variantCount,
      },
      jobs,
      artifacts,
    };
  }

  selectDashboardPostCandidates(input = {}) {
    const clauses = [];
    const params = [];

    if (input.observationId) {
      clauses.push('o.id = ?');
      params.push(input.observationId);
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
        sp.times_seen AS stable_post_times_seen,
        (
          SELECT COUNT(DISTINCT l.ordinal)
          FROM listing_records l
          WHERE l.observation_id = o.id
        ) AS linked_listing_count,
        (
          SELECT j.id
          FROM processing_jobs j
          WHERE j.observation_id = o.id
          ORDER BY j.created_at DESC, j.id DESC
          LIMIT 1
        ) AS latest_job_id,
        (
          SELECT j.status
          FROM processing_jobs j
          WHERE j.observation_id = o.id
          ORDER BY j.created_at DESC, j.id DESC
          LIMIT 1
        ) AS latest_job_status,
        (
          SELECT j.updated_at
          FROM processing_jobs j
          WHERE j.observation_id = o.id
          ORDER BY j.created_at DESC, j.id DESC
          LIMIT 1
        ) AS latest_job_updated_at
      FROM post_observations o
      JOIN sources s ON s.id = o.source_id
      LEFT JOIN stable_posts sp ON sp.id = o.stable_post_id
      ${buildWhereClause(clauses)}
      ORDER BY o.captured_at DESC, o.id DESC
    `).all(...params);

    return rows.map(mapDashboardPostCandidate);
  }

  listDashboardPosts(input = {}) {
    const page = normalizeDashboardPage(input.page, 1);
    const pageSize = normalizeDashboardPageSize(input.pageSize, DEFAULT_DASHBOARD_PAGE_SIZE);
    const sort = normalizeDashboardSort(input.sort, ['newest', 'oldest'], 'newest');
    const now = input.now || new Date().toISOString();
    const normalized = {
      q: normalizeQueryText(input.q),
      postedWithinHours: normalizeNullableNumber(input.postedWithinHours),
      processingStatus: normalizeQueryText(input.processingStatus),
    };

    const filtered = this.selectDashboardPostCandidates(input)
      .filter((post) => matchesDashboardPostFilters(post, normalized, now));
    const sorted = filtered.slice().sort((left, right) => compareDashboardPostRows(left, right, sort));
    const paginated = paginateDashboardItems(sorted, page, pageSize);

    return buildDashboardListResponse({
      items: paginated.map(toDashboardPostListItem),
      page,
      pageSize,
      totalItems: filtered.length,
      sort,
      filters: buildDashboardFilters({
        q: normalized.q,
        sourceKey: input.sourceKey,
        freshness: input.freshness,
        processingStatus: normalized.processingStatus,
        postedWithinHours: normalized.postedWithinHours,
        runId: input.runId,
      }),
    });
  }

  getDashboardPostDetail(input = {}) {
    const observationId = String(input.observationId || '').trim();

    if (!observationId) {
      throw new Error('storage.getDashboardPostDetail requires observationId');
    }

    const [observation] = this.listObservations({
      observationId,
      includeFullText: true,
      includeCollections: true,
      includePayload: true,
      limit: 1,
    });
    if (!observation) {
      return null;
    }

    const [source] = this.listSources({ sourceId: observation.sourceId, limit: 1 });
    const [run] = this.listRecentRuns({ runId: observation.runId, limit: 1 });
    const linkedListings = collapseDashboardListingVariants(
      this.selectDashboardListingCandidates({ observationId }),
    ).map(buildDashboardListingDetailItem);
    const jobs = this.listProcessingJobs({
      observationId,
      limit: 500,
      includeObservationPayload: true,
      includeProcessedPayload: true,
    }).map(toDashboardJobDetailItem);
    const artifacts = this.listArtifactRefs({
      observationId,
      limit: 500,
    });

    return {
      post: buildDashboardObservationDetailItem(observation),
      linkedListings,
      source,
      run,
      provenance: {
        observationId: observation.id,
        runId: observation.runId,
        sourceId: observation.sourceId,
        stablePostId: observation.stablePostId,
        rawArtifactId: observation.rawArtifactId,
        rawArtifactPath: observation.rawArtifactPath,
        stablePostTimesSeen: observation.stablePostTimesSeen ?? null,
      },
      jobs,
      artifacts,
    };
  }

  selectDashboardLatestJobCandidates(input = {}) {
    const clauses = [];
    const params = [];

    if (input.runId) {
      clauses.push('o.run_id = ?');
      params.push(input.runId);
    }

    if (input.observationId) {
      clauses.push('j.observation_id = ?');
      params.push(input.observationId);
    }

    if (input.sourceId) {
      clauses.push('j.source_id = ?');
      params.push(input.sourceId);
    }

    if (input.sourceKey) {
      clauses.push('s.source_key = ?');
      params.push(input.sourceKey);
    }

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
        o.body_text AS observation_body_text,
        p.id AS processed_payload_id,
        p.listing_count AS processed_listing_count,
        p.created_at AS processed_created_at
      FROM processing_jobs j
      JOIN post_observations o ON o.id = j.observation_id
      JOIN sources s ON s.id = j.source_id
      LEFT JOIN processed_payloads p ON p.job_id = j.id
      ${buildWhereClause(clauses)}
      ORDER BY j.created_at DESC, j.id DESC
    `).all(...params);

    const latestByObservation = new Map();

    for (const row of rows) {
      if (latestByObservation.has(row.observation_id)) {
        continue;
      }

      latestByObservation.set(row.observation_id, mapDashboardLatestJobCandidate(row));
    }

    return Array.from(latestByObservation.values());
  }

  buildDashboardReviewCollection(input = {}) {
    const sort = normalizeDashboardSort(input.sort, ['newest', 'oldest'], 'newest');
    const queue = normalizeQueryText(input.queue);
    const now = input.now || new Date().toISOString();
    const postedWithinHours = normalizeNullableNumber(input.postedWithinHours);
    const listings = collapseDashboardListingVariants(this.selectDashboardListingCandidates({
      runId: input.runId,
      sourceId: input.sourceId,
      sourceKey: input.sourceKey,
    })).filter((listing) => matchesDashboardTimeWindow(listing.postedAt, postedWithinHours, now));
    const latestJobs = this.selectDashboardLatestJobCandidates({
      runId: input.runId,
      sourceId: input.sourceId,
      sourceKey: input.sourceKey,
    }).filter((job) => matchesDashboardTimeWindow(job.postedAt, postedWithinHours, now));
    const latestJobByObservationId = new Map(
      latestJobs.map((job) => [job.observationId, job]),
    );
    const primaryListingByObservationId = new Map();

    for (const listing of listings) {
      if (!primaryListingByObservationId.has(listing.observationId)) {
        primaryListingByObservationId.set(listing.observationId, listing);
      }
    }

    const reviewItems = [];

    for (const listing of listings) {
      const latestJob = latestJobByObservationId.get(listing.observationId) || null;
      const reviewCandidates = collectDashboardListingReviewCandidates(listing);

      for (const reviewCandidate of reviewCandidates) {
        reviewItems.push(buildReviewItemFromListing(listing, latestJob, reviewCandidate));
      }
    }

    for (const job of latestJobs) {
      const relatedListing = primaryListingByObservationId.get(job.observationId) || null;

      if (job.processingStatus === 'pending' || job.processingStatus === 'processing') {
        reviewItems.push(buildReviewItemFromJob(job, relatedListing, {
          reviewType: 'pending',
          reasonSummary: job.processingStatus === 'processing'
            ? 'Processing job is still in flight'
            : 'Processing job is queued',
          reasons: [
            job.processingStatus === 'processing'
              ? 'The latest processing job is currently leased by a worker.'
              : 'The latest processing job has not completed yet.',
          ],
        }));
      }

      if (job.processingStatus === 'retryable' || job.processingStatus === 'failed') {
        reviewItems.push(buildReviewItemFromJob(job, relatedListing, {
          reviewType: 'failed',
          reasonSummary: job.lastError || `Processing job is ${job.processingStatus}`,
          reasons: job.lastError
            ? [job.lastError]
            : [`The latest processing job is ${job.processingStatus}.`],
        }));
      }
    }

    const queueCounts = countDashboardReviewItems(reviewItems);
    const filtered = queue
      ? reviewItems.filter((item) => item.reviewType === queue)
      : reviewItems;
    const items = filtered.slice().sort((left, right) => compareDashboardReviewRows(left, right, sort));

    return {
      filters: buildDashboardFilters({
        queue,
        sourceKey: input.sourceKey,
        postedWithinHours,
        runId: input.runId,
      }),
      items,
      queueCounts,
      sort,
      thresholds: {
        lowConfidence: DEFAULT_DASHBOARD_LOW_CONFIDENCE_THRESHOLD,
      },
    };
  }

  listDashboardReviewItems(input = {}) {
    const page = normalizeDashboardPage(input.page, 1);
    const pageSize = normalizeDashboardPageSize(input.pageSize, DEFAULT_DASHBOARD_PAGE_SIZE);
    const reviewCollection = this.buildDashboardReviewCollection(input);
    const paginated = paginateDashboardItems(reviewCollection.items, page, pageSize);

    return {
      ...buildDashboardListResponse({
        items: paginated,
        page,
        pageSize,
        totalItems: reviewCollection.items.length,
        sort: reviewCollection.sort,
        filters: reviewCollection.filters,
      }),
      queueCounts: reviewCollection.queueCounts,
      thresholds: reviewCollection.thresholds,
    };
  }

  getDashboardReviewItem(input = {}) {
    const reviewId = String(input.reviewId || '').trim();

    if (!reviewId) {
      throw new Error('storage.getDashboardReviewItem requires reviewId');
    }

    const separatorIndex = reviewId.indexOf(':');
    if (separatorIndex === -1) {
      return null;
    }

    const reviewType = reviewId.slice(0, separatorIndex);
    const primaryId = reviewId.slice(separatorIndex + 1);
    const reviewCollection = this.buildDashboardReviewCollection({
      ...input,
      queue: input.queue ?? reviewType,
    });
    const item = reviewCollection.items.find((candidate) => (
      candidate.reviewType === reviewType && candidate.primaryId === primaryId
    )) || null;

    if (!item) {
      return null;
    }

    return {
      actions: buildDashboardReviewActions(item),
      item,
      thresholds: reviewCollection.thresholds,
    };
  }

  listDashboardDebugRuns(input = {}) {
    const page = normalizeDashboardPage(input.page, 1);
    const pageSize = normalizeDashboardPageSize(input.pageSize, DEFAULT_DASHBOARD_PAGE_SIZE);
    const sort = 'newest';
    const runs = this.listRecentRuns({
      limit: 500,
      sourceId: input.sourceId,
      sourceKey: input.sourceKey,
      status: input.status,
      runKind: input.runKind,
    }).slice().sort((left, right) => compareIsoDescending(left.startedAt, right.startedAt));
    const paginated = paginateDashboardItems(runs, page, pageSize);

    return buildDashboardListResponse({
      items: paginated,
      page,
      pageSize,
      totalItems: runs.length,
      sort,
      filters: buildDashboardFilters({
        sourceKey: input.sourceKey,
        status: input.status,
        runKind: input.runKind,
      }),
    });
  }

  getDashboardDebugRun(input = {}) {
    const runId = String(input.runId || '').trim();

    if (!runId) {
      throw new Error('storage.getDashboardDebugRun requires runId');
    }

    const [run] = this.listRecentRuns({ runId, limit: 1 });
    if (!run) {
      return null;
    }

    return {
      run,
      validation: this.validateRun({ runId }),
    };
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
      withIds: compareExpectedCount(run.summary?.withIds, counts.identified_observation_count),
    };
    const issues = [];

    if (run.status === 'completed' && !run.finishedAt) {
      issues.push('completed run is missing finishedAt');
    }

    if (run.status === 'completed' && !run.collectedExportPath) {
      issues.push('completed run is missing collectedExportPath');
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

  requireListingRecord(listingId) {
    const listing = this.selectListingRecordById(listingId);
    if (!listing) {
      throw new Error(`storage listing record not found: ${listingId}`);
    }
    return listing;
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

  selectListingRecordById(listingId) {
    const row = this.db.prepare(`
      SELECT *
      FROM listing_records
      WHERE id = ?
    `).get(listingId);

    return mapListingRecord(row);
  }

  selectResolvedFieldByTargetField(targetKind, targetId, fieldPath) {
    const row = this.db.prepare(`
      SELECT *
      FROM resolved_fields
      WHERE target_kind = ? AND target_id = ? AND field_path = ?
    `).get(targetKind, targetId, fieldPath);

    return mapResolvedField(row);
  }

  selectResolvedFieldsByTargets(targetKind, targetIds = [], fieldPaths = []) {
    const normalizedTargetIds = normalizeStringList(targetIds);
    const normalizedFieldPaths = normalizeStringList(fieldPaths);

    if (!normalizedTargetIds.length) {
      return [];
    }

    const clauses = [
      'rf.target_kind = ?',
      `rf.target_id IN (${buildPlaceholders(normalizedTargetIds.length)})`,
    ];
    const params = [targetKind, ...normalizedTargetIds];

    if (normalizedFieldPaths.length) {
      clauses.push(`rf.field_path IN (${buildPlaceholders(normalizedFieldPaths.length)})`);
      params.push(...normalizedFieldPaths);
    }

    const rows = this.db.prepare(`
      SELECT
        rf.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.display_name AS source_display_name,
        o.run_id AS run_id,
        o.stable_post_id AS stable_post_id
      FROM resolved_fields rf
      JOIN sources s ON s.id = rf.source_id
      JOIN post_observations o ON o.id = rf.observation_id
      ${buildWhereClause(clauses)}
      ORDER BY rf.updated_at DESC, rf.id DESC
    `).all(...params);

    return rows.map(mapResolvedField);
  }

  selectManualOverrideByTargetField(targetKind, targetId, fieldPath) {
    const row = this.db.prepare(`
      SELECT *
      FROM manual_overrides
      WHERE target_kind = ? AND target_id = ? AND field_path = ?
    `).get(targetKind, targetId, fieldPath);

    return mapManualOverride(row);
  }

  selectManualOverridesByTargets(targetKind, targetIds = [], fieldPaths = []) {
    const normalizedTargetIds = normalizeStringList(targetIds);
    const normalizedFieldPaths = normalizeStringList(fieldPaths);

    if (!normalizedTargetIds.length) {
      return [];
    }

    const clauses = [
      'mo.target_kind = ?',
      `mo.target_id IN (${buildPlaceholders(normalizedTargetIds.length)})`,
    ];
    const params = [targetKind, ...normalizedTargetIds];

    if (normalizedFieldPaths.length) {
      clauses.push(`mo.field_path IN (${buildPlaceholders(normalizedFieldPaths.length)})`);
      params.push(...normalizedFieldPaths);
    }

    const rows = this.db.prepare(`
      SELECT
        mo.*,
        s.platform AS source_platform,
        s.source_key AS source_key,
        s.display_name AS source_display_name,
        o.run_id AS run_id,
        o.stable_post_id AS stable_post_id
      FROM manual_overrides mo
      JOIN sources s ON s.id = mo.source_id
      JOIN post_observations o ON o.id = mo.observation_id
      ${buildWhereClause(clauses)}
      ORDER BY mo.updated_at DESC, mo.id DESC
    `).all(...params);

    return rows.map(mapManualOverride);
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

  resolveTargetScope(input = {}) {
    const targetKind = String(input.targetKind || '').trim();
    const targetId = String(input.targetId || '').trim();

    if (!targetKind) {
      throw new Error('storage target scope requires targetKind');
    }

    if (!targetId) {
      throw new Error('storage target scope requires targetId');
    }

    if (targetKind === 'listing_record') {
      const listing = this.requireListingRecord(targetId);
      return {
        targetKind,
        targetId,
        sourceId: listing.sourceId,
        observationId: listing.observationId,
      };
    }

    const observationId = normalizeNullableText(input.observationId);
    if (!observationId) {
      throw new Error(`storage target scope requires observationId for targetKind ${targetKind}`);
    }

    const observation = this.requireObservation(observationId);
    const sourceId = normalizeNullableText(input.sourceId) || observation.sourceId;
    this.requireSource(sourceId);

    if (observation.sourceId !== sourceId) {
      throw new Error(`storage target scope source/observation mismatch for ${targetKind}:${targetId}`);
    }

    return {
      targetKind,
      targetId,
      sourceId,
      observationId: observation.id,
    };
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

function mapListingRecord(row) {
  if (!row) return null;

  return {
    id: row.id,
    runId: row.run_id,
    sourceId: row.source_id,
    observationId: row.observation_id,
    ordinal: row.ordinal,
    listingType: row.listing_type,
    postIntent: row.post_intent,
    borough: row.borough,
    neighborhood: row.neighborhood,
    priceAmount: row.price_amount,
    pricePeriod: row.price_period,
    confidenceOverall: row.confidence_overall,
    extractorVersion: row.extractor_version,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function mapEvidenceFragment(row) {
  if (!row) return null;

  return {
    id: row.id,
    sourceId: row.source_id,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceDisplayName: row.source_display_name,
    observationId: row.observation_id,
    stablePostId: row.stable_post_id,
    runId: row.run_id,
    fragmentKind: row.fragment_kind,
    fieldPath: row.field_path,
    sourceSurface: row.source_surface,
    sourceRef: row.source_ref,
    producerKind: row.producer_kind,
    producerVersion: row.producer_version,
    rawText: row.raw_text,
    normalized: parseJson(row.normalized_json),
    confidence: row.confidence,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function mapResolvedField(row) {
  if (!row) return null;

  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    sourceId: row.source_id,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceDisplayName: row.source_display_name,
    observationId: row.observation_id,
    stablePostId: row.stable_post_id,
    runId: row.run_id,
    fieldPath: row.field_path,
    status: row.status,
    resolutionKind: row.resolution_kind,
    resolverVersion: row.resolver_version,
    value: parseJson(row.value_json),
    confidence: row.confidence,
    ambiguity: parseJson(row.ambiguity_json),
    supportingFragmentIds: parseJson(row.supporting_fragment_ids_json, []),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapManualOverride(row) {
  if (!row) return null;

  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    sourceId: row.source_id,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceDisplayName: row.source_display_name,
    observationId: row.observation_id,
    stablePostId: row.stable_post_id,
    runId: row.run_id,
    fieldPath: row.field_path,
    value: parseJson(row.value_json),
    reason: row.reason,
    operatorId: row.operator_id,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clearedAt: row.cleared_at,
  };
}

function mapAuditEvent(row) {
  if (!row) return null;

  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    sourceId: row.source_id,
    sourcePlatform: row.source_platform,
    sourceKey: row.source_key,
    sourceDisplayName: row.source_display_name,
    observationId: row.observation_id,
    stablePostId: row.stable_post_id,
    runId: row.run_id,
    eventKind: row.event_kind,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
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

function uniqueStrings(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
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

const DASHBOARD_LOCATION_FIELD_DEFINITIONS = Object.freeze([
  {
    fieldPath: 'location.address',
    label: 'Address',
    reviewStatuses: Object.freeze({
      ambiguous: true,
      candidate: true,
      unresolved: false,
    }),
    getRawExtracted(listing) {
      return {
        source: 'listing_record.payload.location.address',
        value: listing.rawLocation?.address ?? null,
      };
    },
    getRawObservation(listing) {
      return {
        source: 'post_observations.derivedLocation.address',
        value: listing.observationDerivedLocation?.address ?? null,
      };
    },
  },
  {
    fieldPath: 'location.neighborhood',
    label: 'Neighborhood',
    reviewStatuses: Object.freeze({
      ambiguous: true,
      candidate: true,
      unresolved: true,
    }),
    getRawExtracted(listing) {
      return {
        source: listing.rawLocation?.neighborhoodSource || 'listing_record.payload.location.neighborhood',
        value: listing.rawLocation?.neighborhood ?? null,
      };
    },
    getRawObservation(listing) {
      return {
        source: 'post_observations.derivedLocation.neighborhood',
        value: listing.observationDerivedLocation?.neighborhood ?? null,
      };
    },
  },
  {
    fieldPath: 'location.borough',
    label: 'Borough',
    reviewStatuses: Object.freeze({
      ambiguous: true,
      candidate: true,
      unresolved: true,
    }),
    getRawExtracted(listing) {
      return {
        source: listing.rawLocation?.boroughSource || 'listing_record.payload.location.borough',
        value: listing.rawLocation?.borough ?? null,
      };
    },
    getRawObservation(listing) {
      return {
        source: 'post_observations.derivedLocation.borough',
        value: listing.observationDerivedLocation?.borough ?? null,
      };
    },
  },
  {
    fieldPath: 'location.city',
    label: 'City',
    reviewStatuses: Object.freeze({
      ambiguous: false,
      candidate: false,
      unresolved: false,
    }),
    getRawExtracted(listing) {
      return {
        source: 'listing_record.payload.location.city',
        value: listing.rawLocation?.city ?? null,
      };
    },
    getRawObservation(listing) {
      return {
        source: 'post_observations.derivedLocation.city',
        value: listing.observationDerivedLocation?.city ?? null,
      };
    },
  },
  {
    fieldPath: 'location.state',
    label: 'State',
    reviewStatuses: Object.freeze({
      ambiguous: false,
      candidate: false,
      unresolved: false,
    }),
    getRawExtracted(listing) {
      return {
        source: 'listing_record.payload.location.state',
        value: listing.rawLocation?.state ?? null,
      };
    },
    getRawObservation(listing) {
      return {
        source: 'post_observations.derivedLocation.state',
        value: listing.observationDerivedLocation?.state ?? null,
      };
    },
  },
]);

const DASHBOARD_LOCATION_FIELD_DEFINITION_BY_PATH = new Map(
  DASHBOARD_LOCATION_FIELD_DEFINITIONS.map((definition) => [definition.fieldPath, definition]),
);

function buildTargetFieldKey(targetId, fieldPath) {
  return `${targetId}:${fieldPath}`;
}

function buildDashboardFieldState(input) {
  const rawExtracted = input.fieldDefinition.getRawExtracted(input.listing);
  const rawObservation = input.fieldDefinition.getRawObservation(input.listing);

  return {
    label: input.fieldDefinition.label,
    ...resolveEffectiveFieldValue({
      targetKind: 'listing_record',
      targetId: input.listing.listingId,
      fieldPath: input.fieldDefinition.fieldPath,
      manualOverride: input.manualOverride,
      resolvedField: input.resolvedField,
      rawExtractedSource: rawExtracted.source,
      rawExtractedValue: rawExtracted.value,
      rawObservationSource: rawObservation.source,
      rawObservationValue: rawObservation.value,
    }),
  };
}

function indexDashboardFieldStates(fieldStates) {
  const byPath = new Map();

  for (const fieldState of fieldStates) {
    byPath.set(fieldState.fieldPath, fieldState);
  }

  return byPath;
}

function applyDashboardListingFieldStates(listing, fieldStateByPath) {
  const locationFieldStates = Array.from(fieldStateByPath.values());
  const locationResolutionSummary = summarizeDashboardLocationResolution(locationFieldStates);
  const nextListing = {
    ...listing,
    address: fieldStateByPath.get('location.address')?.effectiveValue ?? null,
    neighborhood: fieldStateByPath.get('location.neighborhood')?.effectiveValue ?? null,
    borough: fieldStateByPath.get('location.borough')?.effectiveValue ?? null,
    city: fieldStateByPath.get('location.city')?.effectiveValue ?? null,
    state: fieldStateByPath.get('location.state')?.effectiveValue ?? null,
    extractorAmbiguityCount: listing.ambiguityCount,
    locationFieldStates,
    locationResolutionSummary,
    resolvedAmbiguityCount: locationResolutionSummary.ambiguousCount,
    reviewAmbiguityCount: listing.ambiguityCount + locationResolutionSummary.ambiguousCount,
  };

  return {
    ...nextListing,
    reviewLinkTarget: buildDashboardListingReviewLinkTarget(nextListing),
  };
}

function mapDashboardListingCandidate(row) {
  if (!row) return null;

  const payload = parseJson(row.payload_json, {}) || {};
  const ambiguities = normalizeDashboardStringArray(payload?.notes?.ambiguities);
  const postedAt = resolveDashboardPostedAt(row.observation_captured_at, row.posted_at_text);
  const observationDerivedLocation = parseJson(row.observation_derived_location_json);
  const listing = {
    listingId: row.id,
    runId: row.run_id,
    sourceId: row.source_id,
    observationId: row.observation_id,
    sourceKey: row.source_key,
    sourceDisplayName: row.source_display_name,
    stablePostId: row.stable_post_id,
    stablePostTimesSeen: row.stable_post_times_seen ?? null,
    postUrl: row.post_url,
    authorName: row.author_name,
    postedAt,
    postedAtText: row.posted_at_text,
    capturedAt: row.observation_captured_at,
    listingSummary: payload?.notes?.summary || summarizeText(row.observation_body_text, 240),
    listingType: row.listing_type,
    intent: row.post_intent,
    borough: row.borough || payload?.location?.borough || null,
    neighborhood: row.neighborhood || payload?.location?.neighborhood || null,
    priceAmount: row.price_amount ?? payload?.pricing?.amount ?? null,
    priceCurrency: payload?.pricing?.currency || 'USD',
    pricePeriod: row.price_period || payload?.pricing?.period || null,
    beds: payload?.rooms?.totalBedrooms ?? null,
    roomsAvailable: payload?.rooms?.roomsAvailable ?? null,
    baths: payload?.rooms?.bathrooms ?? null,
    availableFrom: payload?.dates?.availableFrom ?? null,
    freshness: row.observation_freshness,
    confidenceOverall: row.confidence_overall ?? payload?.confidence?.overall ?? 0,
    ambiguityCount: ambiguities.length,
    ambiguities,
    variantCount: 1,
    extractorVersion: row.extractor_version,
    ordinal: row.ordinal,
    bodyTextPreview: summarizeText(row.observation_body_text, 240),
    rawArtifactPath: row.observation_raw_artifact_path,
    rawArtifactId: row.observation_raw_artifact_id,
    observationDerivedLocation,
    rawLocation: {
      address: payload?.location?.address || null,
      borough: row.borough || payload?.location?.borough || null,
      boroughSource: row.borough ? 'listing_record.borough' : 'listing_record.payload.location.borough',
      city: payload?.location?.city || null,
      neighborhood: row.neighborhood || payload?.location?.neighborhood || null,
      neighborhoodSource: row.neighborhood ? 'listing_record.neighborhood' : 'listing_record.payload.location.neighborhood',
      state: payload?.location?.state || null,
    },
    payload,
    createdAt: row.created_at,
  };

  return {
    ...listing,
    reviewLinkTarget: buildDashboardListingReviewLinkTarget(listing),
  };
}

function mapDashboardPostCandidate(row) {
  if (!row) return null;

  const postedAt = resolveDashboardPostedAt(row.captured_at, row.posted_at_text);

  return {
    observationId: row.id,
    runId: row.run_id,
    sourceId: row.source_id,
    sourceKey: row.source_key,
    sourceDisplayName: row.source_display_name,
    stablePostId: row.stable_post_id,
    stablePostTimesSeen: row.stable_post_times_seen ?? null,
    postUrl: row.post_url,
    authorName: row.author_name,
    postedAt,
    postedAtText: row.posted_at_text,
    capturedAt: row.captured_at,
    freshness: row.freshness,
    processingStatus: row.latest_job_status || 'unprocessed',
    latestJobId: row.latest_job_id || null,
    latestJobUpdatedAt: row.latest_job_updated_at || null,
    bodyPreview: summarizeText(row.body_text, 240),
    bodyText: row.body_text,
    linkedListingCount: Number(row.linked_listing_count || 0),
    rawArtifactPath: row.raw_artifact_path,
    rawArtifactId: row.raw_artifact_id,
  };
}

function mapDashboardLatestJobCandidate(row) {
  if (!row) return null;

  const summary = mapProcessingJobSummary(row, {});
  const postedAt = resolveDashboardPostedAt(summary.capturedAt, summary.postedAtText);

  return {
    jobId: summary.id,
    observationId: summary.observationId,
    runId: summary.observationRunId,
    sourceId: summary.sourceId,
    sourceKey: summary.sourceKey,
    sourceDisplayName: summary.sourceDisplayName,
    postUrl: summary.postUrl,
    authorName: summary.authorName,
    postedAt,
    postedAtText: summary.postedAtText,
    capturedAt: summary.capturedAt,
    processingStatus: summary.status,
    processorVersion: summary.processorVersion,
    schemaVersion: summary.schemaVersion,
    modelName: summary.modelName,
    lastError: summary.lastError,
    attemptCount: summary.attemptCount,
    maxAttempts: summary.maxAttempts,
    processedPayloadId: summary.processedPayloadId || null,
    processedListingCount: summary.processedListingCount ?? null,
    processedAt: summary.processedAt || null,
    updatedAt: summary.updatedAt,
    bodyPreview: summarizeText(row.observation_body_text, 240),
  };
}

function toDashboardListingListItem(listing) {
  if (!listing) return null;

  return {
    address: listing.address ?? null,
    city: listing.city ?? null,
    state: listing.state ?? null,
    listingId: listing.listingId,
    observationId: listing.observationId,
    runId: listing.runId,
    sourceKey: listing.sourceKey,
    sourceDisplayName: listing.sourceDisplayName,
    postUrl: listing.postUrl,
    authorName: listing.authorName,
    postedAt: listing.postedAt,
    postedAtText: listing.postedAtText,
    capturedAt: listing.capturedAt,
    listingSummary: listing.listingSummary,
    listingType: listing.listingType,
    intent: listing.intent,
    borough: listing.borough,
    neighborhood: listing.neighborhood,
    priceAmount: listing.priceAmount,
    priceCurrency: listing.priceCurrency,
    pricePeriod: listing.pricePeriod,
    beds: listing.beds,
    roomsAvailable: listing.roomsAvailable,
    baths: listing.baths,
    availableFrom: listing.availableFrom,
    freshness: listing.freshness,
    confidenceOverall: listing.confidenceOverall,
    ambiguityCount: listing.ambiguityCount,
    extractorAmbiguityCount: listing.extractorAmbiguityCount ?? listing.ambiguityCount,
    resolvedAmbiguityCount: listing.resolvedAmbiguityCount ?? 0,
    reviewAmbiguityCount: listing.reviewAmbiguityCount ?? listing.ambiguityCount,
    locationResolutionSummary: listing.locationResolutionSummary || null,
    variantCount: listing.variantCount,
    extractorVersion: listing.extractorVersion,
    locationFieldStates: listing.locationFieldStates || [],
    reviewLinkTarget: listing.reviewLinkTarget,
  };
}

function buildDashboardListingDetailItem(listing) {
  if (!listing) return null;

  return {
    ...toDashboardListingListItem(listing),
    sourceId: listing.sourceId,
    stablePostId: listing.stablePostId,
    stablePostTimesSeen: listing.stablePostTimesSeen,
    rawArtifactId: listing.rawArtifactId,
    rawArtifactPath: listing.rawArtifactPath,
    ordinal: listing.ordinal,
    createdAt: listing.createdAt,
    bodyTextPreview: listing.bodyTextPreview,
    ambiguities: [...listing.ambiguities],
    extractorAmbiguityCount: listing.extractorAmbiguityCount ?? listing.ambiguityCount,
    resolvedAmbiguityCount: listing.resolvedAmbiguityCount ?? 0,
    reviewAmbiguityCount: listing.reviewAmbiguityCount ?? listing.ambiguityCount,
    locationResolutionSummary: listing.locationResolutionSummary || null,
    locationFieldStates: listing.locationFieldStates || [],
    payload: listing.payload,
  };
}

function buildDashboardListingVariantDetailItem(listing) {
  return buildDashboardListingDetailItem(listing);
}

function toDashboardPostListItem(post) {
  if (!post) return null;

  return {
    observationId: post.observationId,
    runId: post.runId,
    sourceKey: post.sourceKey,
    sourceDisplayName: post.sourceDisplayName,
    postUrl: post.postUrl,
    authorName: post.authorName,
    postedAt: post.postedAt,
    postedAtText: post.postedAtText,
    capturedAt: post.capturedAt,
    freshness: post.freshness,
    processingStatus: post.processingStatus,
    bodyPreview: post.bodyPreview,
    linkedListingCount: post.linkedListingCount,
  };
}

function buildDashboardObservationDetailItem(observation) {
  if (!observation) return null;

  const postedAt = resolveDashboardPostedAt(observation.capturedAt, observation.postedAtText);

  return {
    observationId: observation.id,
    runId: observation.runId,
    sourceId: observation.sourceId,
    sourceKey: observation.sourceKey,
    sourceDisplayName: observation.sourceDisplayName,
    stablePostId: observation.stablePostId,
    stablePostTimesSeen: observation.stablePostTimesSeen ?? null,
    platformPostId: observation.platformPostId,
    postUrl: observation.postUrl,
    authorName: observation.authorName,
    postedAt,
    postedAtText: observation.postedAtText,
    capturedAt: observation.capturedAt,
    freshness: observation.freshness,
    bodyPreview: observation.bodyTextPreview || summarizeText(observation.bodyText, 240),
    bodyText: observation.bodyText || null,
    commentCount: observation.commentCount ?? observation.comments?.length ?? 0,
    mediaCount: observation.mediaCount ?? observation.media?.length ?? 0,
    comments: observation.comments,
    media: observation.media,
    rawArtifactId: observation.rawArtifactId,
    rawArtifactPath: observation.rawArtifactPath,
    payload: observation.payload,
  };
}

function toDashboardJobDetailItem(job) {
  if (!job) return null;

  return {
    jobId: job.id || job.jobId,
    observationId: job.observationId,
    runId: job.observationRunId || job.runId,
    sourceId: job.sourceId,
    sourceKey: job.sourceKey,
    sourceDisplayName: job.sourceDisplayName,
    postUrl: job.postUrl,
    authorName: job.authorName,
    postedAt: resolveDashboardPostedAt(job.capturedAt, job.postedAtText),
    postedAtText: job.postedAtText,
    capturedAt: job.capturedAt,
    processingStatus: job.status || job.processingStatus,
    processorVersion: job.processorVersion,
    schemaVersion: job.schemaVersion,
    modelName: job.modelName,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError || null,
    claimedAt: job.claimedAt || null,
    claimedBy: job.claimedBy || null,
    leaseExpiresAt: job.leaseExpiresAt || null,
    processedPayloadId: job.processedPayloadId || null,
    processedListingCount: job.processedListingCount ?? null,
    processedAt: job.processedAt || null,
    updatedAt: job.updatedAt,
    observationPayload: job.observationPayload,
    processedPayload: job.processedPayload,
  };
}

function normalizeDashboardPage(value, fallback) {
  return normalizePositiveInteger(value, fallback);
}

function normalizeDashboardPageSize(value, fallback) {
  return normalizePositiveInteger(value, fallback, MAX_DASHBOARD_PAGE_SIZE);
}

function normalizeDashboardSort(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeQueryText(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function normalizeNullableNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function normalizeDashboardStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function buildDashboardFilters(filters) {
  const result = {};

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    result[key] = value;
  });

  return result;
}

function buildDashboardListResponse(input) {
  const totalPages = input.totalItems === 0
    ? 0
    : Math.ceil(input.totalItems / input.pageSize);

  return {
    items: input.items,
    count: input.items.length,
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      totalItems: input.totalItems,
      totalPages,
      hasNextPage: totalPages > 0 && input.page < totalPages,
      hasPreviousPage: input.totalItems > 0 && input.page > 1,
    },
    sort: input.sort,
    filters: input.filters,
  };
}

function paginateDashboardItems(items, page, pageSize) {
  const offset = Math.max(0, (page - 1) * pageSize);
  return items.slice(offset, offset + pageSize);
}

function collapseDashboardListingVariants(items) {
  const grouped = new Map();

  for (const item of items) {
    const key = `${item.observationId}:${item.ordinal}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(item);
  }

  return Array.from(grouped.values())
    .map((variants) => {
      const ordered = variants.slice().sort(compareDashboardListingVariantPriority);
      return {
        ...ordered[0],
        variantCount: ordered.length,
      };
    })
    .sort(compareDashboardListingRowsNewestFirst);
}

function compareDashboardListingVariantPriority(left, right) {
  return compareIsoDescending(left.createdAt, right.createdAt)
    || compareNullableNumbers(left.confidenceOverall, right.confidenceOverall, 'desc')
    || compareBooleanDescending(
      isDashboardProcessedExtractorVersion(left.extractorVersion),
      isDashboardProcessedExtractorVersion(right.extractorVersion),
    )
    || compareStringDescending(left.listingId, right.listingId);
}

function matchesDashboardListingFilters(listing, filters, now) {
  const reviewAmbiguityCount = Number(listing.reviewAmbiguityCount ?? listing.ambiguityCount ?? 0);

  if (filters.q && !matchesDashboardTextQuery(filters.q, [
    listing.address,
    listing.city,
    listing.state,
    listing.listingSummary,
    listing.sourceDisplayName,
    listing.authorName,
    listing.neighborhood,
    listing.borough,
    listing.listingType,
    listing.intent,
    listing.postUrl,
    listing.bodyTextPreview,
    ...listing.ambiguities,
  ])) {
    return false;
  }

  if (filters.priceMin !== null && !isNumberAtLeast(listing.priceAmount, filters.priceMin)) {
    return false;
  }

  if (filters.borough && listing.borough !== filters.borough) {
    return false;
  }

  if (filters.neighborhood && listing.neighborhood !== filters.neighborhood) {
    return false;
  }

  if (filters.priceMax !== null && !isNumberAtMost(listing.priceAmount, filters.priceMax)) {
    return false;
  }

  if (filters.bedsMin !== null && !isNumberAtLeast(resolveDashboardBeds(listing), filters.bedsMin)) {
    return false;
  }

  if (filters.bedsMax !== null && !isNumberAtMost(resolveDashboardBeds(listing), filters.bedsMax)) {
    return false;
  }

  if (filters.bathsMin !== null && !isNumberAtLeast(listing.baths, filters.bathsMin)) {
    return false;
  }

  if (filters.minConfidence !== null && !isNumberAtLeast(listing.confidenceOverall, filters.minConfidence)) {
    return false;
  }

  if (filters.hasAmbiguities === true && reviewAmbiguityCount === 0) {
    return false;
  }

  if (filters.hasAmbiguities === false && reviewAmbiguityCount > 0) {
    return false;
  }

  if (!matchesDashboardTimeWindow(listing.postedAt, filters.postedWithinHours, now)) {
    return false;
  }

  return true;
}

function matchesDashboardPostFilters(post, filters, now) {
  if (filters.q && !matchesDashboardTextQuery(filters.q, [
    post.authorName,
    post.sourceDisplayName,
    post.postUrl,
    post.bodyPreview,
    post.bodyText,
  ])) {
    return false;
  }

  if (filters.processingStatus && post.processingStatus !== filters.processingStatus) {
    return false;
  }

  if (!matchesDashboardTimeWindow(post.postedAt, filters.postedWithinHours, now)) {
    return false;
  }

  return true;
}

function matchesDashboardTimeWindow(timestamp, postedWithinHours, now) {
  if (postedWithinHours === null || postedWithinHours === undefined) {
    return true;
  }

  const timestampMs = Date.parse(timestamp || '');
  const nowMs = Date.parse(now || '');
  if (Number.isNaN(timestampMs) || Number.isNaN(nowMs)) {
    return false;
  }

  return timestampMs >= nowMs - (postedWithinHours * 60 * 60 * 1000);
}

function matchesDashboardTextQuery(query, values) {
  const haystack = values
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ');
  return haystack.includes(String(query).toLowerCase());
}

function compareDashboardListingRows(left, right, sort) {
  switch (sort) {
    case 'oldest':
      return compareIsoAscending(left.postedAt, right.postedAt)
        || compareStringAscending(left.listingId, right.listingId);
    case 'price-asc':
      return compareNullableNumbers(left.priceAmount, right.priceAmount, 'asc')
        || compareDashboardListingRowsNewestFirst(left, right);
    case 'price-desc':
      return compareNullableNumbers(left.priceAmount, right.priceAmount, 'desc')
        || compareDashboardListingRowsNewestFirst(left, right);
    case 'confidence-asc':
      return compareNullableNumbers(left.confidenceOverall, right.confidenceOverall, 'asc')
        || compareDashboardListingRowsNewestFirst(left, right);
    case 'confidence-desc':
      return compareNullableNumbers(left.confidenceOverall, right.confidenceOverall, 'desc')
        || compareDashboardListingRowsNewestFirst(left, right);
    case 'newest':
    default:
      return compareDashboardListingRowsNewestFirst(left, right);
  }
}

function compareDashboardListingRowsNewestFirst(left, right) {
  return compareIsoDescending(left.postedAt, right.postedAt)
    || compareIsoDescending(left.capturedAt, right.capturedAt)
    || compareStringDescending(left.listingId, right.listingId);
}

function compareDashboardPostRows(left, right, sort) {
  if (sort === 'oldest') {
    return compareIsoAscending(left.postedAt, right.postedAt)
      || compareStringAscending(left.observationId, right.observationId);
  }

  return compareIsoDescending(left.postedAt, right.postedAt)
    || compareIsoDescending(left.capturedAt, right.capturedAt)
    || compareStringDescending(left.observationId, right.observationId);
}

function compareDashboardReviewRows(left, right, sort) {
  if (sort === 'oldest') {
    return compareIsoAscending(left.postedAt, right.postedAt)
      || compareStringAscending(left.primaryId, right.primaryId);
  }

  return compareIsoDescending(left.postedAt, right.postedAt)
    || compareIsoDescending(left.capturedAt, right.capturedAt)
    || compareStringDescending(left.primaryId, right.primaryId);
}

function deriveListingIncompleteReasons(listing) {
  const reasons = [];

  if (listing.priceAmount === null || listing.priceAmount === undefined) {
    reasons.push('Missing price');
  }

  if (!listing.neighborhood && !listing.borough) {
    reasons.push('Missing location');
  }

  if (resolveDashboardBeds(listing) === null && listing.baths === null) {
    reasons.push('Missing room counts');
  }

  return reasons;
}

function summarizeDashboardLocationResolution(fieldStates) {
  return fieldStates.reduce((summary, fieldState) => {
    const manualOverride = fieldState?.layers?.activeManualOverride || fieldState?.layers?.manualOverride;
    const resolvedField = fieldState?.layers?.resolvedField;

    if (isActiveManualOverride(manualOverride)) {
      summary.manualCount += 1;
    }

    if (!resolvedField) {
      return summary;
    }

    if (resolvedField.status === 'accepted') {
      summary.acceptedCount += 1;
    }
    if (resolvedField.status === 'ambiguous') {
      summary.ambiguousCount += 1;
    }
    if (resolvedField.status === 'candidate') {
      summary.candidateCount += 1;
    }
    if (resolvedField.status === 'unresolved') {
      summary.unresolvedCount += 1;
    }

    return summary;
  }, {
    acceptedCount: 0,
    ambiguousCount: 0,
    candidateCount: 0,
    manualCount: 0,
    unresolvedCount: 0,
  });
}

function collectDashboardResolvedFieldReviewSignals(listing) {
  const ambiguousReasons = [];
  const incompleteReasons = [];
  const fieldStates = Array.isArray(listing.locationFieldStates) ? listing.locationFieldStates : [];

  for (const fieldState of fieldStates) {
    if (isActiveManualOverride(fieldState?.layers?.activeManualOverride || fieldState?.layers?.manualOverride)) {
      continue;
    }

    const resolvedField = fieldState?.layers?.resolvedField;
    const fieldDefinition = DASHBOARD_LOCATION_FIELD_DEFINITION_BY_PATH.get(fieldState?.fieldPath);

    if (!resolvedField || !fieldDefinition) {
      continue;
    }

    if (resolvedField.status === 'ambiguous' && fieldDefinition.reviewStatuses.ambiguous) {
      ambiguousReasons.push(buildDashboardResolvedReviewReason(fieldState, resolvedField, 'ambiguous'));
      continue;
    }

    if (resolvedField.status === 'candidate' && fieldDefinition.reviewStatuses.candidate) {
      incompleteReasons.push(buildDashboardResolvedReviewReason(fieldState, resolvedField, 'candidate'));
      continue;
    }

    if (resolvedField.status === 'unresolved' && fieldDefinition.reviewStatuses.unresolved) {
      incompleteReasons.push(buildDashboardResolvedReviewReason(fieldState, resolvedField, 'unresolved'));
    }
  }

  return {
    ambiguousReasons: uniqueStrings(ambiguousReasons),
    incompleteReasons: uniqueStrings(incompleteReasons),
  };
}

function buildDashboardResolvedReviewReason(fieldState, resolvedField, status) {
  const label = fieldState?.label || fieldState?.fieldPath || 'Field';
  const reasonLabel = humanizeDashboardReason(
    resolvedField?.metadata?.reason
    || resolvedField?.ambiguity?.reason
    || resolvedField?.status,
  );
  const valuePreview = formatDashboardReviewValue(resolvedField?.value);

  if (status === 'ambiguous') {
    return valuePreview
      ? `${label} resolution is ambiguous around ${valuePreview} (${reasonLabel}).`
      : `${label} resolution is ambiguous (${reasonLabel}).`;
  }

  if (status === 'candidate') {
    return valuePreview
      ? `${label} has a candidate value ${valuePreview} that is not accepted yet (${reasonLabel}).`
      : `${label} has a candidate value that is not accepted yet (${reasonLabel}).`;
  }

  return `${label} could not be resolved yet (${reasonLabel}).`;
}

function humanizeDashboardReason(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 'no reason recorded';
  }

  return normalized.replace(/_/gu, ' ');
}

function formatDashboardReviewValue(value) {
  if (!hasEffectiveFallbackValue(value)) {
    return '';
  }

  if (typeof value === 'string') {
    return `"${summarizeText(value, 48)}"`;
  }

  return summarizeText(JSON.stringify(value), 48);
}

function collectDashboardListingReviewCandidates(listing) {
  if (!listing) {
    return [];
  }

  const reviewCandidates = [];
  const resolvedSignals = collectDashboardResolvedFieldReviewSignals(listing);
  const ambiguityReasons = uniqueStrings([
    ...listing.ambiguities,
    ...resolvedSignals.ambiguousReasons,
  ]);

  if (ambiguityReasons.length > 0) {
    reviewCandidates.push({
      reviewType: 'ambiguous',
      reasonSummary: ambiguityReasons.length === 1
        ? '1 ambiguity needs review'
        : `${ambiguityReasons.length} ambiguities need review`,
      reasons: ambiguityReasons,
    });
  }

  if (Number(listing.confidenceOverall ?? 0) < DEFAULT_DASHBOARD_LOW_CONFIDENCE_THRESHOLD) {
    reviewCandidates.push({
      reviewType: 'low-confidence',
      reasonSummary: `Confidence ${formatDashboardConfidence(listing.confidenceOverall)} is below ${formatDashboardConfidence(DEFAULT_DASHBOARD_LOW_CONFIDENCE_THRESHOLD)}`,
      reasons: [
        `Confidence ${formatDashboardConfidence(listing.confidenceOverall)} is below the review threshold ${formatDashboardConfidence(DEFAULT_DASHBOARD_LOW_CONFIDENCE_THRESHOLD)}`,
      ],
    });
  }

  const incompleteReasons = uniqueStrings([
    ...deriveListingIncompleteReasons(listing),
    ...resolvedSignals.incompleteReasons,
  ]);
  if (incompleteReasons.length) {
    reviewCandidates.push({
      reviewType: 'incomplete',
      reasonSummary: incompleteReasons.join(', '),
      reasons: incompleteReasons,
    });
  }

  return reviewCandidates;
}

function buildDashboardListingReviewLinkTarget(listing) {
  const [primaryReviewCandidate] = collectDashboardListingReviewCandidates(listing);

  if (!primaryReviewCandidate) {
    return null;
  }

  return {
    queue: primaryReviewCandidate.reviewType,
    reviewId: `${primaryReviewCandidate.reviewType}:${listing.listingId}`,
  };
}

function buildDashboardReviewActions(item) {
  const fieldStates = Array.isArray(item?.locationFieldStates) ? item.locationFieldStates : [];
  const fieldPaths = fieldStates
    .map((fieldState) => String(fieldState?.fieldPath || '').trim())
    .filter(Boolean);

  if (!item?.listingId || !fieldPaths.length) {
    return {
      manualOverride: {
        supported: false,
      },
    };
  }

  return {
    manualOverride: {
      supported: true,
      targetKind: 'listing_record',
      targetId: item.listingId,
      fieldPaths,
      endpoints: {
        clear: '/api/dashboard/review/manual-overrides/clear',
        set: '/api/dashboard/review/manual-overrides',
      },
    },
  };
}

function buildReviewItemFromListing(listing, latestJob, input) {
  return {
    address: listing.address ?? null,
    borough: listing.borough ?? null,
    city: listing.city ?? null,
    extractorAmbiguityCount: listing.extractorAmbiguityCount ?? listing.ambiguityCount,
    locationFieldStates: listing.locationFieldStates || [],
    locationResolutionSummary: listing.locationResolutionSummary || null,
    neighborhood: listing.neighborhood ?? null,
    reviewType: input.reviewType,
    primaryId: listing.listingId,
    jobId: latestJob?.jobId || null,
    listingId: listing.listingId,
    observationId: listing.observationId,
    runId: listing.runId,
    sourceKey: listing.sourceKey,
    sourceDisplayName: listing.sourceDisplayName,
    state: listing.state ?? null,
    postUrl: listing.postUrl,
    authorName: listing.authorName,
    postedAt: listing.postedAt,
    postedAtText: listing.postedAtText,
    capturedAt: listing.capturedAt,
    summaryText: listing.listingSummary,
    reasonSummary: input.reasonSummary,
    reasons: input.reasons,
    confidenceOverall: listing.confidenceOverall,
    ambiguityCount: listing.reviewAmbiguityCount ?? listing.ambiguityCount,
    resolvedAmbiguityCount: listing.resolvedAmbiguityCount ?? 0,
    processingStatus: latestJob?.processingStatus || 'unprocessed',
    linkTargets: {
      listingId: listing.listingId,
      observationId: listing.observationId,
      runId: listing.runId,
      jobId: latestJob?.jobId || null,
    },
  };
}

function buildReviewItemFromJob(job, relatedListing, input) {
  return {
    address: relatedListing?.address ?? null,
    borough: relatedListing?.borough ?? null,
    city: relatedListing?.city ?? null,
    extractorAmbiguityCount: relatedListing?.extractorAmbiguityCount ?? relatedListing?.ambiguityCount ?? 0,
    locationFieldStates: relatedListing?.locationFieldStates || [],
    locationResolutionSummary: relatedListing?.locationResolutionSummary || null,
    neighborhood: relatedListing?.neighborhood ?? null,
    reviewType: input.reviewType,
    primaryId: job.jobId,
    jobId: job.jobId,
    listingId: relatedListing?.listingId || null,
    observationId: job.observationId,
    runId: job.runId,
    sourceKey: job.sourceKey,
    sourceDisplayName: job.sourceDisplayName,
    state: relatedListing?.state ?? null,
    postUrl: job.postUrl,
    authorName: job.authorName,
    postedAt: job.postedAt,
    postedAtText: job.postedAtText,
    capturedAt: job.capturedAt,
    summaryText: relatedListing?.listingSummary || job.bodyPreview || job.postUrl || job.jobId,
    reasonSummary: input.reasonSummary,
    reasons: input.reasons,
    confidenceOverall: relatedListing?.confidenceOverall ?? null,
    ambiguityCount: relatedListing?.reviewAmbiguityCount ?? relatedListing?.ambiguityCount ?? 0,
    resolvedAmbiguityCount: relatedListing?.resolvedAmbiguityCount ?? 0,
    processingStatus: job.processingStatus,
    linkTargets: {
      listingId: relatedListing?.listingId || null,
      observationId: job.observationId,
      runId: job.runId,
      jobId: job.jobId,
    },
  };
}

function countDashboardReviewItems(items) {
  return items.reduce((counts, item) => {
    counts[item.reviewType] = (counts[item.reviewType] || 0) + 1;
    return counts;
  }, {
    ambiguous: 0,
    'low-confidence': 0,
    incomplete: 0,
    pending: 0,
    failed: 0,
  });
}

function resolveDashboardBeds(listing) {
  if (listing.beds !== null && listing.beds !== undefined) {
    return listing.beds;
  }

  if (listing.roomsAvailable !== null && listing.roomsAvailable !== undefined) {
    return listing.roomsAvailable;
  }

  return null;
}

function isDashboardProcessedExtractorVersion(value) {
  return String(value || '').includes('|');
}

function compareNullableNumbers(left, right, direction = 'asc') {
  const leftNull = left === null || left === undefined || Number.isNaN(Number(left));
  const rightNull = right === null || right === undefined || Number.isNaN(Number(right));

  if (leftNull && rightNull) {
    return 0;
  }

  if (leftNull) {
    return 1;
  }

  if (rightNull) {
    return -1;
  }

  return direction === 'asc'
    ? Number(left) - Number(right)
    : Number(right) - Number(left);
}

function compareBooleanDescending(left, right) {
  return Number(Boolean(right)) - Number(Boolean(left));
}

function compareIsoDescending(left, right) {
  const leftMs = Date.parse(left || '');
  const rightMs = Date.parse(right || '');

  if (Number.isNaN(leftMs) && Number.isNaN(rightMs)) {
    return 0;
  }

  if (Number.isNaN(leftMs)) {
    return 1;
  }

  if (Number.isNaN(rightMs)) {
    return -1;
  }

  return rightMs - leftMs;
}

function compareIsoAscending(left, right) {
  return compareIsoDescending(right, left);
}

function compareStringDescending(left, right) {
  return String(right || '').localeCompare(String(left || ''));
}

function compareStringAscending(left, right) {
  return String(left || '').localeCompare(String(right || ''));
}

function isNumberAtLeast(value, minimum) {
  return value !== null && value !== undefined && Number(value) >= Number(minimum);
}

function isNumberAtMost(value, maximum) {
  return value !== null && value !== undefined && Number(value) <= Number(maximum);
}

function formatDashboardConfidence(value) {
  return Number(value ?? 0).toFixed(2);
}

function resolveDashboardPostedAt(capturedAt, postedAtText) {
  const capturedMs = Date.parse(capturedAt || '');

  if (Number.isNaN(capturedMs)) {
    return null;
  }

  const normalized = String(postedAtText || '').trim();
  if (!normalized) {
    return capturedAt || null;
  }

  const relativeMs = parseDashboardRelativePostedAt(capturedMs, normalized);
  if (relativeMs !== null) {
    return new Date(relativeMs).toISOString();
  }

  const weekdayMs = parseDashboardWeekdayPostedAt(capturedMs, normalized);
  if (weekdayMs !== null) {
    return new Date(weekdayMs).toISOString();
  }

  const absoluteMs = parseDashboardAbsolutePostedAt(capturedMs, normalized);
  if (absoluteMs !== null) {
    return new Date(absoluteMs).toISOString();
  }

  return capturedAt || null;
}

function parseDashboardRelativePostedAt(capturedMs, value) {
  const normalized = value.toLowerCase().replace(/\./g, '').trim();
  if (normalized === 'just now') {
    return capturedMs;
  }

  const relativeMatch = normalized.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)$/u);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];

    if (unit.startsWith('m')) {
      return capturedMs - (amount * 60 * 1000);
    }
    if (unit.startsWith('h')) {
      return capturedMs - (amount * 60 * 60 * 1000);
    }
    if (unit.startsWith('d')) {
      return capturedMs - (amount * 24 * 60 * 60 * 1000);
    }
    if (unit.startsWith('w')) {
      return capturedMs - (amount * 7 * 24 * 60 * 60 * 1000);
    }
  }

  const yesterdayMatch = value.match(/^yesterday(?: at (.+))?$/iu);
  if (yesterdayMatch) {
    const base = new Date(capturedMs);
    base.setDate(base.getDate() - 1);
    applyDashboardTimeOfDay(base, yesterdayMatch[1]);
    return base.getTime();
  }

  return null;
}

function parseDashboardWeekdayPostedAt(capturedMs, value) {
  const weekdayMatch = value.match(/^(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)(?: at (.+))?$/iu);
  if (!weekdayMatch) {
    return null;
  }

  const weekdayIndex = resolveDashboardWeekdayIndex(weekdayMatch[1]);
  if (weekdayIndex === null) {
    return null;
  }

  const base = new Date(capturedMs);
  const diff = (base.getDay() - weekdayIndex + 7) % 7;
  base.setDate(base.getDate() - diff);
  applyDashboardTimeOfDay(base, weekdayMatch[2]);
  return base.getTime();
}

function parseDashboardAbsolutePostedAt(capturedMs, value) {
  const captureDate = new Date(capturedMs);
  const captureYear = captureDate.getFullYear();
  const cleaned = value
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/giu, '$1')
    .replace(/\s+at\s+/iu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasYear = /\b\d{4}\b/u.test(cleaned);
  const withYear = hasYear ? cleaned : `${cleaned}, ${captureYear}`;
  let parsedMs = Date.parse(withYear);

  if (Number.isNaN(parsedMs)) {
    return null;
  }

  if (!hasYear && parsedMs > capturedMs + (36 * 60 * 60 * 1000)) {
    parsedMs = Date.parse(withYear.replace(String(captureYear), String(captureYear - 1)));
  }

  return Number.isNaN(parsedMs) ? null : parsedMs;
}

function applyDashboardTimeOfDay(date, value) {
  if (!value) {
    return;
  }

  const match = String(value).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/iu);
  if (!match) {
    return;
  }

  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2] || 0);
  const meridiem = match[3].toUpperCase();

  if (meridiem === 'PM') {
    hours += 12;
  }

  date.setHours(hours, minutes, 0, 0);
}

function resolveDashboardWeekdayIndex(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const day = normalized.slice(0, 3);

  switch (day) {
    case 'sun':
      return 0;
    case 'mon':
      return 1;
    case 'tue':
      return 2;
    case 'wed':
      return 3;
    case 'thu':
      return 4;
    case 'fri':
      return 5;
    case 'sat':
      return 6;
    default:
      return null;
  }
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

function resolveEffectiveFieldValue(input) {
  const currentManualOverride = input.manualOverride || null;
  const activeManualOverride = currentManualOverride
    && currentManualOverride.status === 'active'
    && !currentManualOverride.clearedAt
      ? currentManualOverride
      : null;
  const currentResolvedField = input.resolvedField || null;
  const acceptedResolvedField = currentResolvedField?.status === 'accepted'
    ? currentResolvedField
    : null;
  const rawExtracted = {
    layer: 'raw_extracted',
    source: input.rawExtractedSource || 'listing_record',
    value: input.rawExtractedValue ?? null,
    isPresent: hasEffectiveFallbackValue(input.rawExtractedValue),
  };
  const rawObservation = {
    layer: 'raw_observation',
    source: input.rawObservationSource || 'observation',
    value: input.rawObservationValue ?? null,
    isPresent: hasEffectiveFallbackValue(input.rawObservationValue),
  };

  let selected = {
    layer: 'missing',
    precedenceRank: 5,
    value: null,
    recordId: null,
    reason: 'No manual, resolved, raw extracted, or raw observation-derived value is present.',
  };

  if (activeManualOverride) {
    selected = {
      layer: 'manual_override',
      precedenceRank: 1,
      value: activeManualOverride.value,
      recordId: activeManualOverride.id,
      reason: 'Active manual override wins over all lower layers.',
    };
  } else if (acceptedResolvedField) {
    selected = {
      layer: 'resolved_field',
      precedenceRank: 2,
      value: acceptedResolvedField.value,
      recordId: acceptedResolvedField.id,
      reason: 'Accepted resolved field wins when no active manual override exists.',
    };
  } else if (rawExtracted.isPresent) {
    selected = {
      layer: 'raw_extracted',
      precedenceRank: 3,
      value: rawExtracted.value,
      recordId: null,
      reason: 'Raw extracted value wins when no higher layer is active.',
    };
  } else if (rawObservation.isPresent) {
    selected = {
      layer: 'raw_observation',
      precedenceRank: 4,
      value: rawObservation.value,
      recordId: null,
      reason: 'Observation-derived fallback wins only when extracted and higher layers are absent.',
    };
  }

  return {
    targetKind: input.targetKind,
    targetId: input.targetId,
    fieldPath: input.fieldPath,
    effectiveValue: selected.value,
    effectiveLayer: selected.layer,
    selected,
    layers: {
      manualOverride: currentManualOverride,
      activeManualOverride,
      resolvedField: currentResolvedField,
      acceptedResolvedField,
      rawExtracted,
      rawObservation,
    },
  };
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

function normalizeManualOverrideAction(value) {
  const normalized = String(value || 'set').trim().toLowerCase();
  return normalized === 'clear' ? 'clear' : 'set';
}

function hasManualOverrideValue(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

function isActiveManualOverride(value) {
  return Boolean(value && value.status === 'active' && !value.clearedAt);
}

function hasEffectiveFallbackValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

function normalizeNullableText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function buildManualOverrideAuditPayload(input) {
  return compactObject({
    action: input.action,
    fieldPath: input.fieldPath,
    manualOverrideId: input.manualOverride?.id || null,
    reviewId: input.reviewId || null,
    reason: input.reason || null,
    previous: input.previousManualOverride ? {
      id: input.previousManualOverride.id,
      status: input.previousManualOverride.status,
      value: input.previousManualOverride.value,
      reason: input.previousManualOverride.reason,
      operatorId: input.previousManualOverride.operatorId,
      clearedAt: input.previousManualOverride.clearedAt,
      updatedAt: input.previousManualOverride.updatedAt,
    } : null,
    next: input.manualOverride ? {
      id: input.manualOverride.id,
      status: input.manualOverride.status,
      value: input.manualOverride.value,
      reason: input.manualOverride.reason,
      operatorId: input.manualOverride.operatorId,
      clearedAt: input.manualOverride.clearedAt,
      updatedAt: input.manualOverride.updatedAt,
    } : null,
  });
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
