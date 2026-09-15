import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { databaseUrl } from '@/lib/env';
import * as schema from './schema';

/**
 * One connection pool per process. Next.js dev mode re-evaluates modules on
 * hot reload, so we stash the pool on globalThis to avoid leaking connections.
 */
declare global {
  // eslint-disable-next-line no-var
  var __modayaPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __modayaDb: NodePgDatabase<typeof schema> | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__modayaPool) {
    const pool = new Pool({ connectionString: databaseUrl(), max: 10 });
    pool.on('error', (err) => {
      console.error('[db] idle client error', err.message);
    });
    globalThis.__modayaPool = pool;
  }
  return globalThis.__modayaPool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!globalThis.__modayaDb) {
    globalThis.__modayaDb = drizzle(getPool(), { schema });
  }
  return globalThis.__modayaDb;
}

export { schema };
