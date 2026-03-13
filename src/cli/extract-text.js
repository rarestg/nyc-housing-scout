import fs from 'node:fs';
import { extractListingsFromText } from '../extractors/text-extractor.js';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node src/cli/extract-text.js <path-to-text-file>');
  process.exit(1);
}

const input = fs.readFileSync(file, 'utf8');
const result = extractListingsFromText(input);
console.log(JSON.stringify(result, null, 2));
