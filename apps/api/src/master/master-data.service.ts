import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';

@Injectable()
export class MasterDataService {
  constructor(private readonly db: DbService) {}

  /** search_products_json — used by inbound/outbound forms. */
  async searchProducts(q: string): Promise<any[]> {
    const like = `%${q.trim()}%`;
    const r = await this.db.query(
      `SELECT p.id, p.product_code, p.product_name, p.uom_type, p.uom_per_pallet,
              p.max_sku_qty, p.max_trans_qty, p.liters_per_unit,
              COALESCE(SUM(s.quantity),0) as stock_qty
       FROM products p
       LEFT JOIN stock s ON s.product_id = p.id AND s.stock_status = 'Available'
       WHERE p.is_active = 1
         AND (p.product_code LIKE $1 OR p.product_name LIKE $2)
       GROUP BY p.id
       ORDER BY p.product_name
       LIMIT 30`,
      [like, like],
    );
    return r.rows.map((x) => ({
      id: Number(x.id),
      text: `${x.product_code} — ${x.product_name}`,
      product_code: x.product_code,
      product_name: x.product_name,
      uom: x.uom_type,
      uom_per_pallet: Number(x.uom_per_pallet),
      liters_per_unit: Number(x.liters_per_unit),
      stock_qty: Number(x.stock_qty),
      max_sku_qty: Number(x.max_sku_qty),
      max_trans_qty: Number(x.max_trans_qty),
    }));
  }

  /** active_users_list — for received_by / picker selectors. */
  async activeUsers(): Promise<any[]> {
    const r = await this.db.query(
      'SELECT id, username, full_name, role FROM users WHERE is_active = 1 ORDER BY full_name',
    );
    return r.rows.map((u) => ({
      id: Number(u.id),
      username: u.username,
      full_name: u.full_name,
      role: u.role,
    }));
  }

  /** products_options — light list for selects (Product::getAll(2000)). */
  async productOptions(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT p.*,
              COALESCE(SUM(s.quantity),0) as total_drums,
              COALESCE(SUM(s.quantity),0) as total_qty,
              COALESCE(SUM(CEILING(s.quantity / GREATEST(p.uom_per_pallet, 1))),0) as total_pallets
       FROM products p
       LEFT JOIN stock s ON p.id = s.product_id
         AND (s.stock_status IN ('Available','Dues In') OR s.stock_status IS NULL OR s.stock_status = '')
         AND s.quantity > 0
         AND (s.location IS NULL OR s.location NOT IN ('QUA_SHELL','STAGING'))
       GROUP BY p.id
       ORDER BY p.product_name
       LIMIT 2000`,
    );
    return r.rows.map((p) => ({
      id: Number(p.id),
      product_code: p.product_code,
      product_name: p.product_name,
      uom: p.uom_type,
      uom_per_pallet: Number(p.uom_per_pallet),
    }));
  }

  /** customers_options — light list. */
  async customerOptions(): Promise<any[]> {
    const r = await this.db.query('SELECT * FROM customers ORDER BY customer_name');
    return r.rows.map((c) => ({
      id: Number(c.id),
      customer_code: c.customer_code,
      customer_name: c.customer_name,
    }));
  }

  /** location_options — light list. */
  async locationOptions(): Promise<any[]> {
    const r = await this.db.query(
      `SELECT lm.*,
              COUNT(sl.id) as occupied_pallets,
              SUM(CASE WHEN sl.status = 'Available' THEN sl.quantity ELSE 0 END) as current_qty,
              CASE WHEN COUNT(CASE WHEN sl.status = 'Available' THEN 1 END) > 0 THEN 'Occupied' ELSE 'Available' END AS availability
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code AND sl.status IN ('Available','Reserved')
       WHERE lm.is_active = 1
       GROUP BY lm.id
       ORDER BY lm.aisle, lm.rack, lm.row_name, lm.position`,
    );
    return r.rows.map((l) => ({
      location_code: l.location_code,
      aisle: l.aisle,
      zone: l.zone,
      is_active: Number(l.is_active),
    }));
  }
}
