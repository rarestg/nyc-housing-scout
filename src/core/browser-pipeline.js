import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export function runBrowser(browserArgs) {
  return execFileSync('openclaw', ['browser', ...browserArgs], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 });
}

export function stripCliBanner(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !line.startsWith('│') && !line.startsWith('◇') && !line.startsWith('├') && !line.startsWith('╮') && !line.startsWith('╯'))
    .join('\n')
    .trim();
}

export function evaluateJson(fn, profileName) {
  const raw = runBrowser(['evaluate', '--browser-profile', profileName, '--fn', fn]);
  return JSON.parse(stripCliBanner(raw));
}

export function loadSeenIds(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function readFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}
