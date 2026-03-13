import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFacebookFeedSnapshot } from '../core/feed-parser.js';
import { extractListingsFromText } from '../extractors/text-extractor.js';

const args = process.argv.slice(2);
const limit = Number(readFlag(args, '--limit', '20'));
const profile = readFlag(args, '--browser-profile', 'chrome');
const outDir = path.resolve(process.cwd(), 'data');
const rawDir = path.join(outDir, 'raw', 'facebook-group');
const normalizedDir = path.join(outDir, 'normalized', 'facebook-group');
const cacheDir = path.join(outDir, 'cache');
const seenFile = path.join(cacheDir, 'seen-post-ids.json');
const runId = new Date().toISOString().replace(/[:.]/g, '-');

fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(normalizedDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });

const seenIds = loadSeenIds(seenFile);
const snapshot = runBrowser(['snapshot', '--browser-profile', profile, '--limit', '1200']);
const cleanedSnapshot = stripCliBanner(snapshot);
const posts = parseFacebookFeedSnapshot(cleanedSnapshot).slice(0, limit);

const results = [];
for (const post of posts) {
  const shouldSkip = post.postId && seenIds.has(post.postId);
  const record = {
    ...post,
    skipped: shouldSkip,
    listings: shouldSkip ? [] : extractListingsFromText(post.bodyText || ''),
    capturedAt: new Date().toISOString(),
  };

  results.push(record);

  const id = post.postId || `unknown-${results.length}`;
  fs.writeFileSync(path.join(rawDir, `${id}.json`), JSON.stringify(record, null, 2));
  if (!shouldSkip && post.postId) seenIds.add(post.postId);
}

fs.writeFileSync(seenFile, JSON.stringify(Array.from(seenIds).sort(), null, 2));
fs.writeFileSync(path.join(normalizedDir, `capture-${runId}.json`), JSON.stringify(results, null, 2));

const summary = {
  requested: limit,
  captured: results.length,
  newPosts: results.filter((r) => !r.skipped).length,
  skippedSeen: results.filter((r) => r.skipped).length,
  withBody: results.filter((r) => r.bodyText).length,
  withSeeMore: results.filter((r) => r.seeMoreRef).length,
  postIds: results.map((r) => r.postId).filter(Boolean),
};

console.log(JSON.stringify(summary, null, 2));

function runBrowser(browserArgs) {
  return execFileSync('openclaw', ['browser', ...browserArgs], { encoding: 'utf8' });
}

function stripCliBanner(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !line.startsWith('│') && !line.startsWith('◇') && !line.startsWith('├') && !line.startsWith('╮') && !line.startsWith('╯'))
    .join('\n')
    .trim();
}

function loadSeenIds(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function readFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}
