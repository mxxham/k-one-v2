import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DbService {
  private readonly logger = new Logger('Db');
  private readonly client: PoolClient | null = null;

  constructor(@Inject('PG_POOL') readonly pool: Pool) {}

  async query<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as any[]);
  }

  /**
   * Run a transaction. `fn(client)` may queue multiple queries; all are committed
   * or rolled back together. Never run await this.query() inside this in a way
   * that touches different connections — use the passed client.
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}