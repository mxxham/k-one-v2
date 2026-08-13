import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../database/db.service';

export interface ActivityContext {
  user_id?: number | null;
  username?: string | null;
  full_name?: string | null;
  ip_address?: string | null;
}

@Injectable()
export class ActivityLogger {
  private readonly logger = new Logger('Activity');

  constructor(private readonly db: DbService) {}

  /**
   * Mirror of ActivityLogger::log. action is stored UPPERCASE, module LOWERCASE.
   * old/new stored as JSON. Never throws — on failure logs to console + debug file.
   */
  async log(
    action: string,
    module: string,
    refType: string | null = null,
    refId: number | null = null,
    refNo: string | null = null,
    description: string | null = null,
    oldValue: unknown = null,
    newValue: unknown = null,
    ctx: ActivityContext = {},
  ): Promise<void> {
    try {
      const refIdVal = refId != null ? refId : null;
      await this.db.query(
        `INSERT INTO activity_log
           (user_id, username, full_name, action, module,
            reference_type, reference_id, reference_no, description,
            old_value, new_value, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          ctx.user_id ?? null,
          ctx.username ?? null,
          ctx.full_name ?? null,
          String(action).toUpperCase(),
          String(module).toLowerCase(),
          refType,
          refIdVal,
          refNo,
          description,
          oldValue != null ? JSON.stringify(oldValue) : null,
          newValue != null ? JSON.stringify(newValue) : null,
          ctx.ip_address ?? null,
        ],
      );
    } catch (e) {
      this.logger.error(`activity_log insert failed: ${(e as Error).message}`);
    }
  }

  /** getRecent mirror. */
  async getRecent(opts: {
    limit?: number;
    offset?: number;
    module?: string;
    userId?: number;
    refType?: string;
    refId?: number;
  }): Promise<any[]> {
    const { limit = 50, offset = 0, module, userId, refType, refId } = opts;
    const where: string[] = [];
    const params: unknown[] = [];
    if (module) {
      params.push(module);
      where.push(`al.module = $${params.length}`);
    }
    if (userId) {
      params.push(userId);
      where.push(`al.user_id = $${params.length}`);
    }
    if (refType) {
      params.push(refType);
      where.push(`al.reference_type = $${params.length}`);
    }
    if (refId != null) {
      params.push(refId);
      where.push(`al.reference_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);
    const r = await this.db.query(
      `SELECT al.*, u.full_name AS user_full_name, u.role AS user_role
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereSql}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return r.rows;
  }

  /** Count mirror for pagination. */
  async countRecent(opts: {
    module?: string;
    userId?: number;
    refType?: string;
    refId?: number;
  }): Promise<number> {
    const { module, userId, refType, refId } = opts;
    const where: string[] = [];
    const params: unknown[] = [];
    if (module) {
      params.push(module);
      where.push(`al.module = $${params.length}`);
    }
    if (userId) {
      params.push(userId);
      where.push(`al.user_id = $${params.length}`);
    }
    if (refType) {
      params.push(refType);
      where.push(`al.reference_type = $${params.length}`);
    }
    if (refId != null) {
      params.push(refId);
      where.push(`al.reference_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM activity_log al ${whereSql}`,
      params,
    );
    return r.rows[0].total;
  }

  getModules(): string[] {
    return [
      'inbound',
      'outbound',
      'stock',
      'picklist',
      'stocktake',
      'bintransfer',
      'ledger',
      'master',
      'user',
      'auth',
      'system',
      'import',
    ];
  }
}
