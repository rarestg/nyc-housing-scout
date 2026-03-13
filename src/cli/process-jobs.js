import { runProcessingBatch } from '../processing/run-processing-batch.js';
import { DEFAULT_GEMINI_THINKING_LEVEL } from '../processing/gemini/config.js';
import { createStorage } from '../storage/storage.js';
import {
  compactObject,
  printJson,
  readDataDir,
  readFlag,
  readProcessingProvenanceFlags,
  readQueueDefaults,
} from './processing-cli-helpers.js';

const args = process.argv.slice(2);

if (hasHelpFlag(args)) {
  printUsage(0);
}

await main();

async function main() {
  const dataDir = readDataDir(args);
  const provenance = readProcessingProvenanceFlags(args);
  const queueDefaults = readQueueDefaults(args);
  const retryDelayMs = readFlag(args, '--retry-delay-ms', '0');
  const envFile = readFlag(args, '--env-file', undefined);
  const temperature = readFlag(args, '--temperature', undefined);
  const thinkingLevel = readFlag(args, '--thinking-level', DEFAULT_GEMINI_THINKING_LEVEL);
  const workerId = readFlag(
    args,
    '--worker-id',
    `local-worker-${process.pid}-${Date.now()}`,
  );
  const storage = createStorage({ dataDir });

  try {
    const result = await runProcessingBatch(storage, {
      runId: readFlag(args, '--run-id', undefined),
      sourceKey: readFlag(args, '--source-key', undefined),
      observationId: readFlag(args, '--observation-id', undefined),
      freshness: readFlag(args, '--freshness', undefined),
      limit: readFlag(args, '--limit', '10'),
      leaseMs: queueDefaults.leaseMs,
      claimedBy: workerId,
      retryDelayMs,
      envFile,
      temperature,
      thinkingLevel,
      ...provenance,
    });

    printJson({
      command: 'process:jobs',
      workerId,
      filters: compactObject({
        runId: readFlag(args, '--run-id', undefined),
        sourceKey: readFlag(args, '--source-key', undefined),
        observationId: readFlag(args, '--observation-id', undefined),
        freshness: readFlag(args, '--freshness', undefined),
        limit: readFlag(args, '--limit', '10'),
        processorVersion: provenance.processorVersion,
        schemaVersion: provenance.schemaVersion,
        modelName: provenance.modelName,
        leaseMs: queueDefaults.leaseMs,
        retryDelayMs,
        envFile,
        temperature,
        thinkingLevel,
      }),
      claimedCount: result.claimedCount,
      processedCount: result.processedCount,
      retryableCount: result.retryableCount,
      failedCount: result.failedCount,
      results: result.results,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    storage.close?.();
  }
}

function hasHelpFlag(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

function printUsage(exitCode, message) {
  if (message) {
    console.error(message);
    console.error('');
  }

  console.error(`Usage:
  npm run process:jobs -- [--source-key key] [--freshness fresh] [--limit 10]
  npm run process:jobs -- --run-id <runId> [--freshness fresh] [--limit 10]

Options:
  --processor-version <value>  Defaults to gemini-structured-v1
  --schema-version <value>     Defaults to gemini-processed-payload-v1
  --model-name <value>         Defaults to gemini-3-flash-preview
  --env-file <path>            Optional env file with GEMINI_API_KEY or GOOGLE_API_KEY.
  --temperature <n>            Gemini temperature override. Defaults to 0.
  --thinking-level <value>     Gemini 3 thinking level override: minimal|low|medium|high. Defaults to minimal.
  --lease-ms <n>               Claim lease in milliseconds. Defaults to 300000.
  --retry-delay-ms <n>         Delay before retryable jobs become claimable. Defaults to 0.
  --worker-id <value>          Override the generated local worker id.
  --data-dir <path>            Override the default ./data directory.`);

  process.exit(exitCode);
}
