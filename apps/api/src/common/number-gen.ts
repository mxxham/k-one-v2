import { QueryResult, QueryResultRow } from 'pg';
import { todayCompact, nowCompactTime } from './date-util';

/**
 * Minimal query surface shared by DbService (the pool) and PoolClient (an
 * open transaction). Lets generateNumber run inside a transaction so the
 * sequence's existence-check + insert see the same uncommitted state.
 */
export interface DbLike {
  query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface NumberSpec {
  table: string;
  column: string;
  /** e.g. 'IN-' */
  prefix: string;
  /** e.g. 'YYYYMM-' (already resolved by caller using todayCompact) */
  searchPrefix: string;
  /** zero-padded width for the counter, e.g. 4 -> 0001 */
  pad?: number;
}

/**
 * Race-safe sequence number generator mirroring PHP's:
 *  find latest LIKE prefix, seq=suffix+1, up to 20 tries with
 *  existence check, then fallback prefix+His+rand(10,99).
 */
export async function generateNumber(
  db: DbLike,
  spec: NumberSpec,
): Promise<string> {
  const { table, column, searchPrefix, prefix, pad = 4 } = spec;
  const like = `${searchPrefix}%`;
  const q = await db.query<{ [k: string]: string }>(
    `SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE $1 ORDER BY ${column} DESC LIMIT 1`,
    [like],
  );
  let seq = 1;
  if (q.rows.length > 0) {
    const last = q.rows[0].v;
    const idx = last.lastIndexOf('-');
    const suffix = idx >= 0 ? last.slice(idx + 1) : last;
    const n = Number.parseInt(suffix, 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  for (let i = 0; i < 20; i++) {
    const candidate = `${prefix}${String(seq).padStart(pad, '0')}`;
    const exists = await db.query<{ id: number }>(
      `SELECT id FROM ${table} WHERE ${column} = $1 LIMIT 1`,
      [candidate],
    );
    if (exists.rows.length === 0) return candidate;
    seq++;
  }
  // Fallback: prefix + His + rand(10,99)
  const rand = Math.floor(Math.random() * 90) + 10;
  return `${prefix}${nowCompactTime()}${rand}`;
}

export function stockTakeNumber(): string {
  // ST-YYYYMMDD-NNNN, random suffix, no collision check (matches PHP).
  const rand = Math.floor(Math.random() * 10_000);
  return `ST-${todayCompact()}-${String(rand).padStart(4, '0')}`;
}

export function adjustmentReference(): string {
  return `ADJ-${todayCompact()}${nowCompactTime()}`;
}

export function stockImportReference(seq: number): string {
  return `IST-${todayCompact()}-${String(seq).padStart(4, '0')}`;
}