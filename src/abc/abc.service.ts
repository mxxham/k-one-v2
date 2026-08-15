import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { ApiException } from '../common/api-exception';

interface AbcSplit {
  a: number;
  b: number;
  c: number;
}

export interface AbcResult {
  rows: Array<{
    product_id: number;
    product_code: string;
    product_name: string;
    picked_qty: number;
    cumulative_qty: number;
    cumulative_share: number;
    velocity_class: 'A' | 'B' | 'C' | null;
  }>;
  total_qty: number;
  counts: { A: number; B: number; C: number; unclassified: number };
  split: AbcSplit;
  date_from: string;
  date_to: string;
}

/**
 * ABC / velocity-based ranking. Products are ranked by total OUT volume from
 * stock_ledger within a date range and bucketed into A/B/C tiers by cumulative
 * volume using a configurable split (default 80/15/5 — standard ABC). This is a
 * read/report-only concern; the classification is stored on products.velocity_class
 * by the admin `recompute` action (recomputed periodically, not in real-time).
 * No stock is relocated based on this class — that stays a human judgement call.
 */
@Injectable()
export class AbcService {
  constructor(private readonly db: DbService) {}

  private parseSplit(a: any, b: any): AbcSplit {
    const aNum = a !== undefined && a !== '' && a !== null ? Number(a) : 80;
    const bNum = b !== undefined && b !== '' && b !== null ? Number(b) : 15;
    if (Number.isNaN(aNum) || Number.isNaN(bNum)) throw ApiException.badRequest('Split A/B harus berupa angka.');
    if (aNum < 0 || bNum < 0 || aNum + bNum > 100) {
      throw ApiException.badRequest('Split harus >= 0 dan total A+B <= 100.');
    }
    return { a: aNum, b: bNum, c: Math.max(0, 100 - aNum - bNum) };
  }

  private parseRange(from?: any, to?: any): { dateFrom: string; dateTo: string } {
    const dateFrom = from ? String(from) : null;
    const dateTo = to ? String(to) : null;
    const valid = (d: string | null) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!valid(dateFrom) || !valid(dateTo)) throw ApiException.badRequest('Format tanggal harus YYYY-MM-DD.');
    // Default: last 90 days.
    const dateFromFinal = dateFrom ?? this.last90();
    const dateToFinal = dateTo ?? this.todayStr();
    return { dateFrom: dateFromFinal, dateTo: dateToFinal };
  }

  private todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private last90(): string {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }

  private async volumePerProduct(dateFrom: string, dateTo: string): Promise<Array<{ product_id: number; qty: number }>> {
    const r = await this.db.query(
      `SELECT sl.product_id, COALESCE(SUM(sl.quantity_out),0)::numeric AS qty
       FROM stock_ledger sl
       WHERE sl.transaction_type = 'OUT'
         AND sl.transaction_date BETWEEN $1 AND $2
         AND sl.quantity_out > 0
       GROUP BY sl.product_id
       ORDER BY qty DESC, sl.product_id ASC`,
      [dateFrom, dateTo],
    );
    return r.rows.map((x) => ({ product_id: Number(x.product_id), qty: Number(x.qty) }));
  }

  private productLookup(ids: number[]): Promise<any[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.query(
      `SELECT id, product_code, product_name FROM products WHERE id = ANY($1)`,
      [ids],
    ).then((r) => r.rows);
  }

  /** Core ABC bucketing. Returns rows sorted by volume desc with class assigned. */
  private async bucket(dateFrom: string, dateTo: string, split: AbcSplit): Promise<AbcResult['rows']> {
    const volumes = await this.volumePerProduct(dateFrom, dateTo);
    const totalQty = volumes.reduce((s, v) => s + v.qty, 0);
    const ids = volumes.map((v) => v.product_id);
    const products = await this.productLookup(ids);
    const byId = new Map(products.map((p) => [Number(p.id), p]));

    const aBound = split.a / 100;
    const abBound = (split.a + split.b) / 100;
    let cumulative = 0;
    let first = true;
    const rows = volumes.map((v) => {
      cumulative += v.qty;
      const share = totalQty > 0 ? cumulative / totalQty : 0;
      let cls: 'A' | 'B' | 'C' | null = null;
      if (totalQty > 0) {
        if (first && split.a > 0) {
          // The top mover always lands in A when there is any A band — a single
          // product driving 100% of volume is a fast mover, not the long tail.
          cls = 'A';
        } else if (share <= aBound) {
          cls = 'A';
        } else if (share <= abBound) {
          cls = 'B';
        } else {
          cls = 'C';
        }
        first = false;
      }
      const p = byId.get(v.product_id);
      return {
        product_id: v.product_id,
        product_code: p?.product_code ?? null,
        product_name: p?.product_name ?? null,
        picked_qty: v.qty,
        cumulative_qty: cumulative,
        cumulative_share: Number(share.toFixed(4)),
        velocity_class: cls,
      };
    });
    return rows;
  }

  /** Report-only analysis for a date range (does NOT write velocity_class). */
  async analyze(from?: any, to?: any, splitA?: any, splitB?: any): Promise<AbcResult> {
    const { dateFrom, dateTo } = this.parseRange(from, to);
    const split = this.parseSplit(splitA, splitB);
    const rows = await this.bucket(dateFrom, dateTo, split);
    const counts = { A: 0, B: 0, C: 0, unclassified: 0 };
    for (const r of rows) {
      if (r.velocity_class === 'A') counts.A++;
      else if (r.velocity_class === 'B') counts.B++;
      else if (r.velocity_class === 'C') counts.C++;
      else counts.unclassified++;
    }
    const totalQty = rows.reduce((s, r) => s + r.picked_qty, 0);
    return { rows, total_qty: totalQty, counts, split, date_from: dateFrom, date_to: dateTo };
  }

  /**
   * Admin-triggered recompute: writes velocity_class to every product.
   * Products with no OUT volume in range are left NULL (unclassified) rather than
   * being forced into C — absence of recent activity isn't the same as slow-moving.
   */
  async recompute(from?: any, to?: any, splitA?: any, splitB?: any): Promise<AbcResult> {
    const { dateFrom, dateTo } = this.parseRange(from, to);
    const split = this.parseSplit(splitA, splitB);
    const rows = await this.bucket(dateFrom, dateTo, split);

    await this.db.transaction(async (client) => {
      await client.query('UPDATE products SET velocity_class = NULL, velocity_class_at = NULL WHERE velocity_class IS NOT NULL');
      for (const r of rows) {
        if (!r.velocity_class) continue;
        await client.query(
          'UPDATE products SET velocity_class = $1, velocity_class_at = NOW() WHERE id = $2',
          [r.velocity_class, r.product_id],
        );
      }
    });

    const counts = { A: 0, B: 0, C: 0, unclassified: 0 };
    for (const r of rows) {
      if (r.velocity_class === 'A') counts.A++;
      else if (r.velocity_class === 'B') counts.B++;
      else if (r.velocity_class === 'C') counts.C++;
      else counts.unclassified++;
    }
    const totalQty = rows.reduce((s, r) => s + r.picked_qty, 0);
    return { rows, total_qty: totalQty, counts, split, date_from: dateFrom, date_to: dateTo };
  }
}