/**
 * Queue + job definitions shared between the API (producer) and the worker
 * (consumer). The async import queue carries a payload produced by the API's
 * import dispatch actions; the worker runs the auto-import engine.
 */

export const QUEUE = {
  IMPORT: 'kone-import',
} as const;

export type AsyncImportKind = 'auto';

export interface AsyncImportJobData {
  /** Unique id for the import run (returned to the client as task_id). */
  task_id: string;
  kind: AsyncImportKind;
  /** File buffer stored in Redis under `kone:file:<task_id>` by the API. */
  file_key: string;
  /** Original uploaded filename. */
  filename: string;
  /** form fields relevant to the import. */
  form: Record<string, any>;
  /** acting user id. */
  user_id: number;
}

export interface ImportTaskStatus {
  task_id: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  message?: string;
  result?: Record<string, any>;
}

/** Redis keys the API/worker use to coordinate tasks + file buffers. */
export const TASK_KEYS = {
  file: (taskId: string) => `kone:file:${taskId}`,
  status: (taskId: string) => `kone:task:${taskId}`,
} as const;

/** FEFO/stock-take critical-section lock names. */
export const LOCK_KEYS = {
  fefo: (productId: number | string) => `fefo:${productId}`,
  stocktake: (stockTakeId: number | string) => `stocktake:${stockTakeId}`,
  import: () => 'import:auto',
} as const;