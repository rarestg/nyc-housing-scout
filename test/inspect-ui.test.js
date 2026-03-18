import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveArtifactFilePath, startInspectionServer } from '../src/ui/inspection-server.js';

test('resolveArtifactFilePath allows relative paths inside data roots and blocks traversal', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-ui-'));
  const dataDir = path.join(workspaceRoot, 'data');
  const rawDir = path.join(dataDir, 'raw', 'facebook');
  fs.mkdirSync(rawDir, { recursive: true });

  const workspaceFile = path.join(rawDir, 'capture.json');
  fs.writeFileSync(workspaceFile, '{}\n', 'utf8');
  const dataRelativeFile = path.join(rawDir, 'local.json');
  fs.writeFileSync(dataRelativeFile, '{}\n', 'utf8');

  assert.equal(
    resolveArtifactFilePath('data/raw/facebook/capture.json', { workspaceRoot, dataDir }),
    workspaceFile,
  );
  assert.equal(
    resolveArtifactFilePath('raw/facebook/local.json', { workspaceRoot, dataDir }),
    dataRelativeFile,
  );
  assert.throws(
    () => resolveArtifactFilePath('../outside.json', { workspaceRoot, dataDir }),
    /Artifact path must stay inside data/,
  );
});

test('inspection server serves dashboard at root and keeps the legacy inspector mounted', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-ui-'));
  const dataDir = path.join(workspaceRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const handle = await startInspectionServer({
    dataDir,
    host: '127.0.0.1',
    port: 0,
  });

  t.after(async () => {
    await handle.close();
  });

  const dashboardResponse = await fetch(`${handle.url}/listings`);
  const dashboardHtml = await dashboardResponse.text();
  assert.equal(dashboardResponse.status, 200);
  assert.match(dashboardHtml, /NYC Housing Scout Dashboard/);
  assert.match(dashboardHtml, /\/dashboard\/app\.js/);

  const inspectorResponse = await fetch(`${handle.url}/inspector`);
  const inspectorHtml = await inspectorResponse.text();
  assert.equal(inspectorResponse.status, 200);
  assert.match(inspectorHtml, /NYC Housing Scout Inspector/);
  assert.match(inspectorHtml, /\/app\.js/);
});

test('dashboard bundle includes Review override actions and keeps Debug non-editorial messaging', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-ui-'));
  const dataDir = path.join(workspaceRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const handle = await startInspectionServer({
    dataDir,
    host: '127.0.0.1',
    port: 0,
  });

  t.after(async () => {
    await handle.close();
  });

  const bundleResponse = await fetch(`${handle.url}/dashboard/app.js`);
  const bundleText = await bundleResponse.text();
  assert.equal(bundleResponse.status, 200);
  assert.match(bundleText, /Save manual value/);
  assert.match(bundleText, /\/api\/dashboard\/review\/manual-overrides/);
  assert.match(bundleText, /Open in Review/);
  assert.doesNotMatch(bundleText, /Review this listing/);
  assert.match(bundleText, /Correction actions stay in Review so Debug remains forensic\./);
});
