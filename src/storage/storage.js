import path from 'node:path';
import { SqliteStorage } from './sqlite-storage.js';

export function createStorage(options = {}) {
  const dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
  const driver = options.driver || 'sqlite';

  if (driver !== 'sqlite') {
    throw new Error(`Unsupported storage driver: ${driver}`);
  }

  return new SqliteStorage({
    dbFile: path.join(dataDir, 'storage', 'nyc-housing-scout.sqlite'),
  });
}
