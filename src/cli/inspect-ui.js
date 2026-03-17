import { startInspectionServer } from '../ui/inspection-server.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  printUsage(0);
}

const host = readFlag(args, '--host', '127.0.0.1');
const port = readFlag(args, '--port', '4310');
const dataDir = readFlag(args, '--data-dir', 'data');

const handle = await startInspectionServer({
  host,
  port,
  dataDir,
});

console.log(`Inspection UI running at ${handle.url}`);
console.log(`Data directory: ${dataDir}`);
console.log('Press Ctrl+C to stop.');

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log('\nShutting down inspection UI...');

    try {
      await handle.close();
      process.exit(0);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
}

function readFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  return argv[index + 1] ?? fallback;
}

function printUsage(exitCode, message) {
  if (message) {
    console.error(message);
    console.error('');
  }

  console.error(`Usage:
  npm run inspect:ui -- [--host 127.0.0.1] [--port 4310] [--data-dir data]

Options:
  --host <value>      Host interface to bind. Defaults to 127.0.0.1.
  --port <value>      Port to bind. Defaults to 4310.
  --data-dir <path>   Override the default ./data directory.`);

  process.exit(exitCode);
}
