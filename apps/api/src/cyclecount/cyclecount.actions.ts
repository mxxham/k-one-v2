import { Injectable } from '@nestjs/common';
import { CycleCountService } from './cyclecount.service';
import { ActivityLogger } from '../common/activity-logger';
import { RedisLockService } from '../common/redis-lock.service';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';
import { LOCK_KEYS } from '@k-one/shared';

type Q = Record<string, any>;

/**
 * Cycle count scheduling (Phase 10). Inventory department. Create/update/delete
 * are write-level; "Run Due Schedules" and "Run Now" are admin-only. Generation
 * reuses StockTakeService.create() via CycleCountService — see service notes for
 * the future BullMQ scheduler hook-in point.
 */
@Injectable()
export class CycleCountActions {
  constructor(
    private readonly cyclecount: CycleCountService,
    private readonly activity: ActivityLogger,
    private readonly lock: RedisLockService,
  ) {
    registerActions('cyclecount', {
      list: (c) => this.list(c),
      create: (c) => this.create(c),
      update: (c) => this.update(c),
      delete: (c) => this.delete(c),
      run_due: (c) => this.runDue(c),
      run_now: (c) => this.runNow(c),
    });
    setPermission('cyclecount', 'create', 'write');
    setPermission('cyclecount', 'update', 'write');
    setPermission('cyclecount', 'delete', 'write');
    setPermission('cyclecount', 'run_due', 'admin');
    setPermission('cyclecount', 'run_now', 'admin');
    setModuleDepartments('cyclecount', ['inventory']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async list(_ctx: RequestContext): Promise<Q> {
    return this.cyclecount.list();
  }

  private async create(ctx: RequestContext): Promise<Q> {
    const id = await this.cyclecount.create(ctx.body, ctx.user.id);
    await this.activity.log('CREATE_CYCLECOUNT', 'cyclecount', 'CycleCount', id, null, 'Buat jadwal cycle count ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async update(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.body.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    await this.cyclecount.update(id, ctx.body);
    await this.activity.log('UPDATE_CYCLECOUNT', 'cyclecount', 'CycleCount', id, null, 'Edit jadwal cycle count ID ' + id, null, null, this.actCtx(ctx));
    return { success: true };
  }

  private async delete(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.body.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    await this.cyclecount.delete(id);
    await this.activity.log('DELETE_CYCLECOUNT', 'cyclecount', 'CycleCount', id, null, 'Hapus jadwal cycle count ID ' + id, null, null, this.actCtx(ctx));
    return { success: true };
  }

  private async runDue(ctx: RequestContext): Promise<Q> {
    const result = await this.lock.runLocked(
      LOCK_KEYS.cycleCount(),
      () => this.cyclecount.runDue(ctx.user.id),
      { ttlMs: 120_000 },
    );
    await this.activity.log(
      'RUN_CYCLECOUNT', 'cyclecount', 'CycleCount', null, null,
      `Run due schedules: ${result.count} stock take dibuat (${result.generated.map((g) => g.take_number).join(', ') || '-'})`,
      null, null, this.actCtx(ctx),
    );
    return result;
  }

  private async runNow(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.body.id ?? ctx.query.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    const result = await this.lock.runLocked(
      LOCK_KEYS.cycleCount(),
      () => this.cyclecount.runNow(id, ctx.user.id),
      { ttlMs: 120_000 },
    );
    await this.activity.log(
      'RUN_CYCLECOUNT', 'cyclecount', 'CycleCount', id, null,
      `Run now jadwal #${id}: stock take ${result.generated[0]?.take_number ?? ''} dibuat`,
      null, null, this.actCtx(ctx),
    );
    return result;
  }
}