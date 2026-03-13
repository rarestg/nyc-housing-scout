import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFacebookFeedSnapshot } from '../core/feed-parser.js';
import { extractListingsFromText } from '../extractors/text-extractor.js';

const args = process.argv.slice(2);
const target = Number(readFlag(args, '--target', '20'));
const maxScrolls = Number(readFlag(args, '--max-scrolls', '20'));
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
const collected = new Map();
const stepLog = [];

for (let scroll = 0; scroll <= maxScrolls; scroll += 1) {
  expandVisibleSeeMore(profile, 8);
  const snapshot = stripCliBanner(runBrowser(['snapshot', '--browser-profile', profile, '--limit', '1600']));
  const posts = parseFacebookFeedSnapshot(snapshot);

  let addedThisRound = 0;
  for (const post of posts) {
    const key = post.postId || post.dedupeKey;
    if (collected.has(key)) continue;
    post.skipped = Boolean(post.postId && seenIds.has(post.postId));
    post.listings = post.skipped ? [] : extractListingsFromText(post.bodyText || '');
    post.capturedAt = new Date().toISOString();
    collected.set(key, post);
    addedThisRound += 1;

    const id = post.postId || sanitizeFilename(post.authorName || key);
    fs.writeFileSync(path.join(rawDir, `${id}.json`), JSON.stringify(post, null, 2));
    if (post.postId && !post.skipped) seenIds.add(post.postId);
    if (collected.size >= target) break;
  }

  stepLog.push({ scroll, visiblePosts: posts.length, addedThisRound, collected: collected.size });
  if (collected.size >= target) break;
  runBrowser(['press', 'PageDown', '--browser-profile', profile]);
  runBrowser(['wait', '--browser-profile', profile, '--time', '1200']);
}

const results = Array.from(collected.values()).slice(0, target);
fs.writeFileSync(seenFile, JSON.stringify(Array.from(seenIds).sort(), null, 2));
fs.writeFileSync(path.join(normalizedDir, `crawl-${runId}.json`), JSON.stringify(results, null, 2));

console.log(JSON.stringify({
  target,
  collected: results.length,
  newPosts: results.filter((r) => !r.skipped).length,
  skippedSeen: results.filter((r) => r.skipped).length,
  stepLog,
  postIds: results.map((r) => r.postId).filter(Boolean)
}, null, 2));

function expandVisibleSeeMore(browserProfile, limit) {
  const snapshot = stripCliBanner(runBrowser(['snapshot', '--browser-profile', browserProfile, '--limit', '1600']));
  const posts = parseFacebookFeedSnapshot(snapshot).filter((post) => post.seeMoreRef).slice(0, limit);
  for (const post of posts) {
    try {
      runBrowser(['click', post.seeMoreRef, '--browser-profile', browserProfile]);
      runBrowser(['wait', '--browser-profile', browserProfile, '--time', '300']);
    } catch {}
  }
}

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

function sanitizeFilename(value) {
  return String(value || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80);
}
