import fs from 'node:fs';
import path from 'node:path';
import {
  hasFlag,
  readFlag,
} from './processing-cli-helpers.js';
import {
  DEFAULT_GEMINI_ENV_FILE_CANDIDATES,
  DEFAULT_GEMINI_KEY_CHECK_MODEL_NAME,
  DEFAULT_GEMINI_KEY_CHECK_THINKING_LEVEL,
  DEFAULT_GEMINI_MODEL_NAME,
  DEFAULT_GEMINI_PROCESSOR_VERSION,
  DEFAULT_GEMINI_SCHEMA_VERSION,
  DEFAULT_GEMINI_THINKING_LEVEL,
  findGeminiEnvFile,
  loadEnvFile,
  resolveGeminiApiKey,
  runGeminiApiKeyCheck,
  runGeminiStructuredExtraction,
} from '../processing/gemini/structured-output-experiment.js';
import {
  GEMINI_CANONICAL_SCHEMA_SOURCE,
  GEMINI_STRUCTURED_OUTPUT_SCHEMA,
} from '../processing/gemini/canonical-schema.js';

const args = process.argv.slice(2);

if (hasHelpFlag(args)) {
  printUsage(0);
}

await main();

function hasHelpFlag(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

async function main() {
  try {
    const envFile = readFlag(args, '--env-file', undefined);
    const shouldCheckApiKey = hasFlag(args, '--check-api-key');
    const schemaPath = readFlag(args, '--schema', undefined);
    const inputPath = readFlag(args, '--input', undefined);
    const outputPath = readFlag(args, '--output', readFlag(args, '--out', undefined));
    resolveGeminiEnv(envFile);

    if (!shouldCheckApiKey && !inputPath && process.stdin.isTTY) {
      printUsage(1, 'Provide --input <path> or pipe JSON to stdin.');
    }

    const { apiKey } = resolveGeminiApiKey();
    if (!apiKey) {
      printUsage(
        1,
        'Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY, pass --env-file <path>, or create data/cache/gemini/gemini.env.',
      );
    }

    if (shouldCheckApiKey) {
      await runApiKeyCheck({
        apiKey,
        outputPath,
      });
      return;
    }

    const input = await readInputJson(inputPath);
    const resolvedSchemaPath = schemaPath
      ? path.resolve(process.cwd(), schemaPath)
      : null;
    const outputSchema = resolvedSchemaPath
      ? readJsonFile(resolvedSchemaPath)
      : GEMINI_STRUCTURED_OUTPUT_SCHEMA;
    const result = await runGeminiStructuredExtraction({
      apiKey,
      inputPost: input.value,
      outputSchema,
      modelName: readFlag(args, '--model', readFlag(args, '--model-name', DEFAULT_GEMINI_MODEL_NAME)),
      processorVersion: readFlag(args, '--processor-version', DEFAULT_GEMINI_PROCESSOR_VERSION),
      schemaVersion: readFlag(args, '--schema-version', DEFAULT_GEMINI_SCHEMA_VERSION),
      temperature: readFlag(args, '--temperature', '0'),
      thinkingLevel: readFlag(args, '--thinking-level', DEFAULT_GEMINI_THINKING_LEVEL),
      inputSource: input.source,
      schemaSource: resolvedSchemaPath
        ? {
            kind: 'file',
            path: resolvedSchemaPath,
          }
        : GEMINI_CANONICAL_SCHEMA_SOURCE,
    });
    const serialized = `${JSON.stringify(result, null, 2)}\n`;

    writeOutput(serialized, outputPath);
    process.stdout.write(serialized);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function runApiKeyCheck({ apiKey, outputPath }) {
  try {
    const checkResult = await runGeminiApiKeyCheck({
      apiKey,
      modelName: readFlag(args, '--check-model', DEFAULT_GEMINI_KEY_CHECK_MODEL_NAME),
      thinkingLevel: readFlag(
        args,
        '--thinking-level',
        DEFAULT_GEMINI_KEY_CHECK_THINKING_LEVEL,
      ),
    });
    const output = `true\n${checkResult.text || ''}\n`;

    writeOutput(output, outputPath);
    process.stdout.write(output);
  } catch (error) {
    const output = `false\n${error instanceof Error ? error.message : String(error)}\n`;

    writeOutput(output, outputPath);
    process.stderr.write(output);
    process.exit(1);
  }
}

function resolveGeminiEnv(explicitEnvFile) {
  if (explicitEnvFile) {
    const loaded = loadEnvFile(explicitEnvFile);
    return {
      envFile: loaded.path,
      apiKeySource: {
        envVar: null,
        envFile: loaded.path,
      },
    };
  }

  const existingKey = resolveGeminiApiKey();
  if (existingKey.apiKey) {
    return {
      envFile: null,
      apiKeySource: {
        envVar: existingKey.envVar,
        envFile: null,
      },
    };
  }

  const discoveredEnvFile = findGeminiEnvFile(DEFAULT_GEMINI_ENV_FILE_CANDIDATES);
  if (!discoveredEnvFile) {
    return {
      envFile: null,
      apiKeySource: {
        envVar: null,
        envFile: null,
      },
    };
  }

  const loaded = loadEnvFile(discoveredEnvFile);
  const loadedKey = resolveGeminiApiKey();

  return {
    envFile: loaded.path,
    apiKeySource: {
      envVar: loadedKey.envVar,
      envFile: loaded.path,
    },
  };
}

async function readInputJson(inputPathValue) {
  if (!inputPathValue || inputPathValue === '-') {
    const source = await readStdin();
    if (!source.trim()) {
      throw new Error('Stdin was empty. Provide JSON input via stdin or --input <path>.');
    }

    return {
      value: parseJson(source, 'stdin'),
      source: {
        kind: 'stdin',
      },
    };
  }

  const resolvedPath = path.resolve(process.cwd(), inputPathValue);
  const source = fs.readFileSync(resolvedPath, 'utf8');

  return {
    value: parseJson(source, resolvedPath),
    source: {
      kind: 'file',
      path: resolvedPath,
    },
  };
}

function readJsonFile(filePath) {
  return parseJson(fs.readFileSync(filePath, 'utf8'), filePath);
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let source = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      source += chunk;
    });
    process.stdin.on('end', () => {
      resolve(source);
    });
    process.stdin.on('error', reject);
  });
}

function writeOutput(serialized, outputPath) {
  if (!outputPath) {
    return;
  }

  const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, serialized, 'utf8');
}

function printUsage(exitCode, message) {
  if (message) {
    console.error(message);
    console.error('');
  }

  console.error(`Usage:
  npm run gemini:extract -- --input <path> [--output <path>]
  cat post.json | npm run gemini:extract
  npm run gemini:extract -- --check-api-key

Options:
  --schema <path>            Optional JSON schema file. Defaults to the canonical repo schema.
  --input <path|->           JSON post or observation input. Omit or use - to read stdin.
  --output <path>            Optional file path for the full response envelope JSON.
  --env-file <path>          Optional env file with GEMINI_API_KEY or GOOGLE_API_KEY.
  --model <value>            Defaults to gemini-3-flash-preview.
  --processor-version <v>    Defaults to gemini-structured-v1.
  --schema-version <v>       Defaults to gemini-processed-payload-v1.
  --temperature <n>          Defaults to 0.
  --thinking-level <value>   One of minimal|low|medium|high. Defaults to minimal for Gemini extraction and key checks.
  --check-api-key            Run a lightweight live key check instead of extraction.
  --check-model <value>      Defaults to gemini-3.1-flash-lite-preview for key checks.

Notes:
  If --env-file is omitted, the CLI auto-checks data/cache/gemini/gemini.env, then data/gemini/gemini.env.
  Existing environment variables win over values loaded from env files.
  The command preserves input postUrl provenance outside the model output envelope.`);

  process.exit(exitCode);
}
