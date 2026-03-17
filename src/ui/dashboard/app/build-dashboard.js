import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import esbuild from 'esbuild';

const DASHBOARD_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_POINT = path.join(DASHBOARD_ROOT, 'app', 'main.jsx');
const DIST_DIR = path.join(DASHBOARD_ROOT, 'dist');
const DIST_FILE = path.join(DIST_DIR, 'app.js');

export async function bundleDashboardApp() {
  const result = await esbuild.build({
    absWorkingDir: DASHBOARD_ROOT,
    bundle: true,
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
    },
    entryPoints: [ENTRY_POINT],
    format: 'esm',
    jsx: 'automatic',
    legalComments: 'none',
    loader: {
      '.js': 'jsx',
      '.jsx': 'jsx',
    },
    minify: false,
    outfile: 'app.js',
    platform: 'browser',
    target: ['es2022'],
    write: false,
  });

  const outputFile = result.outputFiles.find((file) => file.path.endsWith('app.js'))
    || result.outputFiles.find((file) => file.path.endsWith('.js'))
    || result.outputFiles[0];

  if (!outputFile) {
    throw new Error('Dashboard build produced no JavaScript output.');
  }

  return outputFile.text;
}

async function main() {
  const appBundle = await bundleDashboardApp();
  await fs.mkdir(DIST_DIR, { recursive: true });
  await fs.writeFile(DIST_FILE, appBundle, 'utf8');
  console.log(`Dashboard bundle written to ${DIST_FILE}`);
}

const cliEntryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (cliEntryUrl === import.meta.url) {
  await main();
}
