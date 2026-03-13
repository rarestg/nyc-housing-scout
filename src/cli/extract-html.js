import fs from 'node:fs';
import { extractListingsFromHtml } from '../extractors/html-extractor.js';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node src/cli/extract-html.js <path-to-html-file>');
  process.exit(1);
}

const input = fs.readFileSync(file, 'utf8');
const result = extractListingsFromHtml(input);
console.log(JSON.stringify(result, null, 2));
