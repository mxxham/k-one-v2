/**
 * BullMQ worker process. Consumes the kone:import queue; each job carries an
 * AsyncImportJobData payload. Runs the auto-import engine inside a single DB
 * transaction, updates the task status in Redis, and (optionally) emits the
 * result to a completion channel the API/frontend can poll.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { QUEUE, TASK_KEYS, AsyncImportJobData, ImportTaskStatus } from '@k-one/shared';
import { readWorkbookSheets } from './sheet.reader';
import { runAutoImport } from './import.engine';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PG_URL = process.env.DATABASE_URL ?? 'postgres://kone:kone@localhost:5432/kone';

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const pool = new Pool({ connectionString: PG_URL, max: 8 });

async function setStatus(taskId: string, status: ImportTaskStatus['status'], extra: Partial<ImportTaskStatus> = {}): Promise<void> {
  const payload: ImportTaskStatus = { task_id: taskId, status, ...extra };
  await redis.set(TASK_KEYS.status(taskId), JSON.stringify(payload), 'EX', 3600);
}

async function processImportJob(job: Job<AsyncImportJobData>): Promise<ImportTaskStatus> {
  const data = job.data;
  await setStatus(data.task_id, 'processing', { message: 'Memproses file...' });

  const raw = await redis.getBuffer(TASK_KEYS.file(data.task_id));
  if (!raw) {
    const msg = 'File upload tidak ditemukan (expired).';
    await setStatus(data.task_id, 'error', { message: msg });
    throw new Error(msg);
  }
  const sheets = readWorkbookSheets(raw, data.filename);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const report = await runAutoImport(client, { sheets, userId: data.user_id });
    await client.query('COMMIT');
    const status: ImportTaskStatus = { task_id: data.task_id, status: 'done', message: report.message, result: report };
    await setStatus(data.task_id, 'done', { message: report.message, result: report });
    return status;
  } catch (e: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    const msg = e?.message ?? 'Import gagal.';
    await setStatus(data.task_id, 'error', { message: msg });
    throw e;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const worker = new Worker<AsyncImportJobData>(QUEUE.IMPORT, processImportJob, {
    connection: redis,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  });

  worker.on('completed', (job) => {
    process.stdout.write(`[import] task ${job.data.task_id} done\n`);
  });
  worker.on('failed', (job, err) => {
    process.stdout.write(`[import] task ${job?.data?.task_id ?? '?'} failed: ${err?.message ?? err}\n`);
  });

  const shutdown = async (): Promise<void> => {
    process.stdout.write('worker shutting down...\n');
    await worker.close();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.stdout.write('K-one worker listening on queue ' + QUEUE.IMPORT + '\n');
}

main().catch((err) => {
  process.stderr.write('worker fatal: ' + (err?.message ?? err) + '\n');
  process.exit(1);
});