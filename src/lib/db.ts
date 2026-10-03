import pg from "pg";
import { config } from "./config";

// pg returns bigint/int8 as string; chat ids and message ids fit in a JS number.
pg.types.setTypeParser(20, (v) => Number(v));
// date columns as plain 'YYYY-MM-DD' strings (no JS Date timezone surprises).
pg.types.setTypeParser(1082, (v) => v);

const g = globalThis as unknown as { __pool?: pg.Pool };

export function pool(): pg.Pool {
  if (!g.__pool) g.__pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 });
  return g.__pool;
}

export type Q = Pick<pg.Pool, "query">;

export async function query<T extends pg.QueryResultRow = any>(
  text: string, params?: unknown[], q: Q = pool(),
): Promise<T[]> {
  return (await q.query<T>(text, params as any[])).rows;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function kvSet(key: string, value: unknown) {
  await query(
    `INSERT INTO kv(key,value,updated_at) VALUES ($1,$2::text::jsonb,now())
     ON CONFLICT (key) DO UPDATE SET value=$2::text::jsonb, updated_at=now()`,
    [key, JSON.stringify(value)],
  );
}
export async function kvGet<T = any>(key: string): Promise<{ value: T; updated_at: Date } | null> {
  const r = await query(`SELECT value, updated_at FROM kv WHERE key=$1`, [key]);
  if (!r[0]) return null;
  // tolerate a double-encoded value (a JSON string holding JSON)
  const v = typeof r[0].value === "string" ? JSON.parse(r[0].value) : r[0].value;
  return { value: v, updated_at: r[0].updated_at };
}
