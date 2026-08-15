import { Injectable } from '@nestjs/common';
import { AbcService } from './abc.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';

type Q = Record<string, any>;

/**
 * ABC Analysis / velocity-based ranking. Read-only report (`analyze`) for anyone,
 * plus an admin-triggered `recompute` that persists velocity_class onto products.
 * Department: `all` (products/stock pages that show the badge are cross-dept reads).
 */
@Injectable()
export class AbcActions {
  constructor(
    private readonly abc: AbcService,
    private readonly activity: ActivityLogger,
  ) {
    registerActions('abc', {
      analyze: (c) => this.analyze(c),
      recompute: (c) => this.recompute(c),
    });
    setPermission('abc', 'recompute', 'admin');
    setModuleDepartments('abc', ['all']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async analyze(ctx: RequestContext): Promise<Q> {
    const q = ctx.query;
    const result = await this.abc.analyze(q.date_from, q.date_to, q.split_a, q.split_b);
    return result;
  }

  private async recompute(ctx: RequestContext): Promise<Q> {
    const q = ctx.query;
    const body = ctx.body ?? {};
    const result = await this.abc.recompute(
      q.date_from ?? body.date_from,
      q.date_to ?? body.date_to,
      q.split_a ?? body.split_a,
      q.split_b ?? body.split_b,
    );
    const split = result.split;
    await this.activity.log(
      'RECOMPUTE_ABC', 'abc', 'Product', null, null,
      `Recompute ABC: A ${split.a}% / B ${split.b}% / C ${split.c}% — A:${result.counts.A} B:${result.counts.B} C:${result.counts.C} (${result.date_from} → ${result.date_to})`,
      null, null, this.actCtx(ctx),
    );
    return result;
  }
}