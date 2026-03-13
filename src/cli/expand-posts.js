import { execFileSync } from 'node:child_process';
import { parseFacebookFeedSnapshot } from '../core/feed-parser.js';

const args = process.argv.slice(2);
const limit = Number(readFlag(args, '--limit', '10'));
const profile = readFlag(args, '--browser-profile', 'chrome');
const dryRun = args.includes('--dry-run');

const snapshot = stripCliBanner(runBrowser(['snapshot', '--browser-profile', profile, '--limit', '1200']));
const posts = parseFacebookFeedSnapshot(snapshot)
  .filter((post) => post.seeMoreRef)
  .slice(0, limit);

for (const post of posts) {
  if (!dryRun) {
    runBrowser(['click', post.seeMoreRef, '--browser-profile', profile]);
  }
  console.log(JSON.stringify({ postId: post.postId, authorName: post.authorName, seeMoreRef: post.seeMoreRef, clicked: !dryRun }));
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

function readFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}
