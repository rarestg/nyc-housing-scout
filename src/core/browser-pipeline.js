import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export function runBrowser(browserArgs) {
  return execFileSync('openclaw', ['browser', ...browserArgs], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 });
}

export function appendBrowserTargetId(browserArgs, targetId) {
  if (!targetId) {
    return [...browserArgs];
  }

  const args = Array.isArray(browserArgs) ? [...browserArgs] : [];
  if (!args.length) {
    return args;
  }

  return [args[0], '--target-id', String(targetId), ...args.slice(1)];
}

export function stripCliBanner(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !line.startsWith('│') && !line.startsWith('◇') && !line.startsWith('├') && !line.startsWith('╮') && !line.startsWith('╯'))
    .join('\n')
    .trim();
}

export function runBrowserJson(browserArgs) {
  return JSON.parse(stripCliBanner(runBrowser(browserArgs)));
}

export function evaluateJson(fn, profileName, targetId = null) {
  return runBrowserJson(appendBrowserTargetId([
    'evaluate',
    '--browser-profile',
    profileName,
    '--fn',
    fn,
  ], targetId));
}

export function buildEvaluateCall(runtime, ...args) {
  const source = typeof runtime === 'function' ? runtime.toString() : String(runtime || '');
  const serializedArgs = args.map((arg) => JSON.stringify(arg)).join(', ');
  return `() => (${source})(${serializedArgs})`;
}

export function getBrowserStatus(profileName) {
  return runBrowserJson(['--browser-profile', profileName, '--json', 'status']);
}

export function getBrowserTabs(profileName) {
  return runBrowserJson(['--browser-profile', profileName, '--json', 'tabs']);
}

export function loadSeenIds(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function hasFlag(argv, name) {
  return argv.includes(name);
}

export function readFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}
