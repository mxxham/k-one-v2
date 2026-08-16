import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { ApiException } from '../common/api-exception';
import { StockTakeService } from '../stocktake/stocktake.service';
import { todayStr } from '../common/date-util';

type Q = Record<string, any>;

const FREQUENCIES = ['weekly', 'monthly', 'quarterly'];
const SCOPE_TYPES = ['full', 'location', 'velocity'];

export interface CycleCountSchedule {
  id: number;
  schedule_name: string;
  frequency: string;
  scope_type: string;
  scope_locations: string | null;
  velocity_class: string | null;
  next_run_date: string;
  is_active: boolean;
  created_by: number;
}

export interface RunDueResult {
  generated: Array<{ schedule_id: number; schedule_name: string; stock_take_id: number; take_number: string; scope_type: string; velocity_class: string | null }>;
  count: number;
}

/**
 * Cycle count scheduling (Phase 10). Recurring stock-take program: a schedule
 * declares a frequency + scope (full / locations / S26 velocity-class), and a
 * manual admin "run due schedules" action generates stock takes by reusing the
 * EXISTING StockTakeService.create() — never reimplemented here.
 *
 * NOTE — future scheduler hook-in: a real cron should be a BullMQ repeatable
 * job in apps/worker that calls the exact same `runDue()` entry point on some
 * interval; this phase intentionally keeps the trigger manual.
 */
@Injectable()
export class CycleCountService {
  constructor(
    private readonly db: DbService,
    private readonly stocktake: StockTakeService,
  ) {}

  private parseScopeLocations(v: any): string[] | null {
    if (v === null || v === undefined || v === '') return null;
    let arr: unknown;
    if (typeof v === 'string') {
      try {
        arr = JSON.parse(v);
      } catch {
        arr = null;
      }
    } else {
      arr = v;
    }
    if (!Array.isArray(arr)) return null;
    return arr.map((x) => String(x)).filter((x) => x.trim() !== '');
  }

  async list(): Promise<{ rows: Q[] }> {
    const r = await this.db.query(
      `SELECT ccs.*, u.full_name AS created_by_name,
              (CASE WHEN ccs.is_active AND ccs.next_run_date <= CURRENT_DATE THEN true ELSE false END) AS is_due,
              COUNT(st.id)::int AS total_generated
       FROM cycle_count_schedules ccs
       LEFT JOIN users u ON ccs.created_by = u.id
       LEFT JOIN stock_take st ON st.schedule_id = ccs.id
       GROUP BY ccs.id, u.full_name
       ORDER BY ccs.next_run_date ASC, ccs.id ASC`,
    );
    return { rows: r.rows };
  }

  async getById(id: number): Promise<CycleCountSchedule | null> {
    const r = await this.db.query('SELECT * FROM cycle_count_schedules WHERE id = $1', [id]);
    return (r.rows[0] as CycleCountSchedule) ?? null;
  }

  async create(data: Q, userId: number): Promise<number> {
    const name = String(data.schedule_name ?? '').trim();
    if (!name) throw ApiException.badRequest('Nama jadwal wajib diisi.');
    const frequency = String(data.frequency ?? 'monthly');
    if (!FREQUENCIES.includes(frequency)) throw ApiException.badRequest('Frequency harus weekly/monthly/quarterly.');
    const scopeType = String(data.scope_type ?? 'full');
    if (!SCOPE_TYPES.includes(scopeType)) throw ApiException.badRequest('scope_type harus full/location/velocity.');

    const scopeLocs = this.parseScopeLocations(data.scope_locations);
    if (scopeType === 'location' && (!scopeLocs || scopeLocs.length === 0)) {
      throw ApiException.badRequest('scope_type location memerlukan scope_locations.');
    }
    let velocityClass: string | null = null;
    if (scopeType === 'velocity') {
      velocityClass = data.velocity_class ? String(data.velocity_class).toUpperCase() : null;
      if (!velocityClass || !['A', 'B', 'C'].includes(velocityClass)) {
        throw ApiException.badRequest('scope_type velocity memerlukan velocity_class A/B/C.');
      }
    }

    const nextRunDate = data.next_run_date ? String(data.next_run_date) : todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextRunDate)) throw ApiException.badRequest('Format next_run_date harus YYYY-MM-DD.');

    const isActive = data.is_active === undefined || data.is_active === null || data.is_active === true || data.is_active === '1' || data.is_active === 1;

    const r = await this.db.query(
      `INSERT INTO cycle_count_schedules
         (schedule_name, frequency, scope_type, scope_locations, velocity_class, next_run_date, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [name, frequency, scopeType, scopeLocs ? JSON.stringify(scopeLocs) : null, velocityClass, nextRunDate, isActive, userId],
    );
    return Number(r.rows[0].id);
  }

  async update(id: number, data: Q): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw ApiException.notFound('Jadwal tidak ditemukan.');

    const name = data.schedule_name !== undefined ? String(data.schedule_name).trim() : existing.schedule_name;
    if (!name) throw ApiException.badRequest('Nama jadwal wajib diisi.');
    const frequency = data.frequency !== undefined ? String(data.frequency) : existing.frequency;
    if (!FREQUENCIES.includes(frequency)) throw ApiException.badRequest('Frequency harus weekly/monthly/quarterly.');
    const scopeType = data.scope_type !== undefined ? String(data.scope_type) : existing.scope_type;
    if (!SCOPE_TYPES.includes(scopeType)) throw ApiException.badRequest('scope_type harus full/location/velocity.');

    const scopeLocsRaw = data.scope_locations !== undefined ? data.scope_locations : existing.scope_locations;
    const scopeLocs = this.parseScopeLocations(scopeLocsRaw);
    if (scopeType === 'location' && (!scopeLocs || scopeLocs.length === 0)) {
      throw ApiException.badRequest('scope_type location memerlukan scope_locations.');
    }
    let velocityClass: string | null = existing.velocity_class;
    if (data.velocity_class !== undefined) {
      velocityClass = data.velocity_class ? String(data.velocity_class).toUpperCase() : null;
    }
    if (scopeType === 'velocity' && (!velocityClass || !['A', 'B', 'C'].includes(velocityClass))) {
      throw ApiException.badRequest('scope_type velocity memerlukan velocity_class A/B/C.');
    }

    const nextRunDate = data.next_run_date !== undefined ? String(data.next_run_date) : existing.next_run_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextRunDate)) throw ApiException.badRequest('Format next_run_date harus YYYY-MM-DD.');

    const isActive = data.is_active !== undefined
      ? data.is_active === true || data.is_active === '1' || data.is_active === 1
      : existing.is_active;

    await this.db.query(
      `UPDATE cycle_count_schedules
       SET schedule_name=$1, frequency=$2, scope_type=$3, scope_locations=$4, velocity_class=$5,
           next_run_date=$6, is_active=$7, updated_at=NOW()
       WHERE id=$8`,
      [name, frequency, scopeType, scopeLocs ? JSON.stringify(scopeLocs) : null, velocityClass, nextRunDate, isActive, id],
    );
  }

  async delete(id: number): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw ApiException.notFound('Jadwal tidak ditemukan.');
    await this.db.query('DELETE FROM cycle_count_schedules WHERE id = $1', [id]);
  }

  /**
   * Generate a stock_take from a schedule by REUSING StockTakeService.create()
   * (the same entry point the manual stock-take form uses) — no reimplementation.
   * Then loads the item set via autoLoadByLocations (optionally velocity-filtered).
   * Finally advances next_run_date by the schedule's frequency.
   */
  private async runOne(schedule: CycleCountSchedule, userId: number): Promise<{ stock_take_id: number; take_number: string }> {
    const scopeLocs = this.parseScopeLocations(schedule.scope_locations);
    const scopeType = scopeLocs && scopeLocs.length > 0 ? 'location' : schedule.scope_type;

    const id = await this.stocktake.create(
      {
        take_date: todayStr(),
        status: 'Draft',
        notes: `Dibuat otomatis dari jadwal: ${schedule.schedule_name} (${schedule.frequency})`,
        scope_locations: scopeType === 'location' ? scopeLocs : null,
        scope_type: scopeType,
        schedule_id: schedule.id,
      },
      userId,
    );

    if (scopeType === 'velocity') {
      await this.stocktake.autoLoadByLocations(id, null, schedule.velocity_class);
    } else if (scopeType === 'location') {
      await this.stocktake.autoLoadByLocations(id, scopeLocs);
    } else {
      await this.stocktake.autoLoadByLocations(id, null);
    }

    const take = await this.db.query('SELECT take_number FROM stock_take WHERE id = $1', [id]);
    return { stock_take_id: id, take_number: take.rows[0]?.take_number ?? String(id) };
  }

  private advanceDate(date: string, frequency: string): string {
    const d = new Date(`${date}T00:00:00Z`);
    if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
    else if (frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCMonth(d.getUTCMonth() + 3);
    return d.toISOString().slice(0, 10);
  }

  /** Admin action — generate stock takes for every active schedule that is due (next_run_date <= today). */
  async runDue(userId: number): Promise<RunDueResult> {
    const r = await this.db.query(
      `SELECT * FROM cycle_count_schedules
       WHERE is_active = TRUE AND next_run_date <= CURRENT_DATE
       ORDER BY next_run_date ASC, id ASC`,
    );
    const generated: RunDueResult['generated'] = [];
    for (const row of r.rows as CycleCountSchedule[]) {
      const res = await this.runOne(row, userId);
      const newDate = this.advanceDate(row.next_run_date, row.frequency);
      await this.db.query('UPDATE cycle_count_schedules SET next_run_date = $1, updated_at = NOW() WHERE id = $2', [newDate, row.id]);
      generated.push({
        schedule_id: row.id,
        schedule_name: row.schedule_name,
        stock_take_id: res.stock_take_id,
        take_number: res.take_number,
        scope_type: row.scope_type,
        velocity_class: row.velocity_class,
      });
    }
    return { generated, count: generated.length };
  }

  /** Admin action — run a single schedule now regardless of its next_run_date, then advance it. */
  async runNow(id: number, userId: number): Promise<RunDueResult> {
    const schedule = await this.getById(id);
    if (!schedule) throw ApiException.notFound('Jadwal tidak ditemukan.');
    const res = await this.runOne(schedule, userId);
    const newDate = this.advanceDate(todayStr(), schedule.frequency);
    await this.db.query('UPDATE cycle_count_schedules SET next_run_date = $1, updated_at = NOW() WHERE id = $2', [newDate, schedule.id]);
    return {
      generated: [
        {
          schedule_id: schedule.id,
          schedule_name: schedule.schedule_name,
          stock_take_id: res.stock_take_id,
          take_number: res.take_number,
          scope_type: schedule.scope_type,
          velocity_class: schedule.velocity_class,
        },
      ],
      count: 1,
    };
  }
}