import { Injectable } from '@nestjs/common';
import { ImportService } from './import.service';
import { ImportQueueProvider } from './import-queue.provider';
import { registerActions, RequestContext, setPermission } from '../dispatcher/registry';
import { tplInbound, tplOutbound, tplStock } from './import-templates';
import { ApiException } from '../common/api-exception';
import { TASK_KEYS } from '@k-one/shared';
import { randomUUID } from 'crypto';

type Q = Record<string, any>;

/**
 * Binary payload marker. The gateway detects this and streams the workbook
 * instead of JSON (parity with PHP template downloads).
 */
export interface BinaryResult {
  _binary: true;
  buffer: Buffer;
  filename: string;
  contentType: string;
}

@Injectable()
export class ImportActions {
  constructor(
    private readonly importService: ImportService,
    private readonly importQueue: ImportQueueProvider,
  ) {
    registerActions('import', {
      tpl_inbound: () => this.tplInbound(),
      tpl_outbound: () => this.tplOutbound(),
      tpl_stock: () => this.tplStock(),
      inbound: (c) => this.inbound(c),
      outbound: (c) => this.outbound(c),
      stock_preview: (c) => this.stockPreview(c),
      stock_commit: (c) => this.stockCommit(c),
      auto: (c) => this.auto(c),
      auto_async: (c) => this.autoAsync(c),
      task_status: (c) => this.taskStatus(c),
    });
    setPermission('import', 'inbound', 'write');
    setPermission('import', 'outbound', 'write');
    setPermission('import', 'stock_preview', 'write');
    setPermission('import', 'stock_commit', 'write');
    setPermission('import', 'auto', 'write');
    setPermission('import', 'auto_async', 'write');
  }

  private async tplInbound(): Promise<BinaryResult> {
    const r = await tplInbound();
    return { _binary: true, buffer: r.buffer, filename: r.filename, contentType: r.contentType };
  }

  private async tplOutbound(): Promise<BinaryResult> {
    const r = await tplOutbound();
    return { _binary: true, buffer: r.buffer, filename: r.filename, contentType: r.contentType };
  }

  private async tplStock(): Promise<BinaryResult> {
    const r = await tplStock();
    return { _binary: true, buffer: r.buffer, filename: r.filename, contentType: r.contentType };
  }

  private async inbound(ctx: RequestContext): Promise<Q> {
    if (ctx.user) ctx.raw.kone_user_id = ctx.user.id;
    return this.importService.runInbound(ctx.raw);
  }

  private async outbound(ctx: RequestContext): Promise<Q> {
    if (ctx.user) ctx.raw.kone_user_id = ctx.user.id;
    return this.importService.runOutbound(ctx.raw);
  }

  private async stockPreview(ctx: RequestContext): Promise<Q> {
    return this.importService.stockPreview(ctx.raw);
  }

  private async stockCommit(ctx: RequestContext): Promise<Q> {
    return this.importService.stockCommit(ctx.body);
  }

  private async auto(ctx: RequestContext): Promise<Q> {
    if (ctx.user) ctx.raw.kone_user_id = ctx.user.id;
    return this.importService.runAuto(ctx.raw);
  }

  /**
   * Async variant (spec-3 §3.6): stores the uploaded buffer in Redis, enqueues
   * a BullMQ job, and returns {success:true, message, task_id}. The worker
   * runs the same auto-import engine; task_status polls the result.
   */
  private async autoAsync(ctx: RequestContext): Promise<Q> {
    if (ctx.user) ctx.raw.kone_user_id = ctx.user.id;
    const taskId = randomUUID();
    const { buffer, name } = this.importService.fileFromReq(ctx.raw);
    const ttl = 60 * 60 * 1000;
    await this.importQueue.redis.set(TASK_KEYS.file(taskId), buffer, 'EX', ttl);
    await this.importQueue.enqueue(taskId, {
      task_id: taskId,
      kind: 'auto',
      file_key: TASK_KEYS.file(taskId),
      filename: name,
      form: ctx.body ?? {},
      user_id: ctx.user ? ctx.user.id : 1,
    });
    return {
      message: 'Import sedang diproses',
      task_id: taskId,
    };
  }

  private async taskStatus(ctx: RequestContext): Promise<Q> {
    const taskId = String(ctx.query.task_id ?? ctx.body.task_id ?? '');
    if (taskId === '') throw ApiException.badRequest('task_id required');
    const raw = await this.importQueue.redis.get(TASK_KEYS.status(taskId));
    if (!raw) {
      return { status: 'queued', task_id: taskId, message: 'Import belum selesai diproses.' };
    }
    return JSON.parse(raw);
  }
}
