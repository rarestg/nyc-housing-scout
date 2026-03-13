import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureDir, sanitizeFilename, writeJsonFile } from './file-utils.js';

export function prepareArtifactLayers({ outDir, platform = 'facebook', sourceKey, sourceSlug, runId }) {
  const sourceDir = sanitizeFilename(sourceKey || sourceSlug || 'default');
  return {
    rawDir: ensureDir(path.join(outDir, 'raw', platform, sourceDir, runId)),
    collectedDir: ensureDir(path.join(outDir, 'collected', platform, sourceDir)),
    listingsDir: ensureDir(path.join(outDir, 'listings', platform, sourceDir)),
    storageDir: ensureDir(path.join(outDir, 'storage')),
    cacheDir: ensureDir(path.join(outDir, 'cache')),
  };
}

export function writeRawArtifact(rawDir, artifactId, payload, cwd = process.cwd()) {
  const filePath = path.join(rawDir, `${artifactId}.json`);
  return writeJsonArtifact(filePath, payload, cwd);
}

export function writeRunArtifact(dir, prefix, runId, payload, cwd = process.cwd()) {
  const filePath = path.join(dir, `${prefix}-${runId}.json`);
  return writeJsonArtifact(filePath, payload, cwd);
}

function writeJsonArtifact(filePath, payload, cwd) {
  writeJsonFile(filePath, payload);
  const buffer = fs.readFileSync(filePath);
  return {
    relativePath: path.relative(cwd, filePath),
    byteSize: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    createdAt: new Date().toISOString(),
  };
}
