import { Injectable } from '@nestjs/common';
import { AsnService } from './asn.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission, setModuleDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

type Q = Record<string, any>;

@Injectable()
export class AsnActions {
  constructor(
    private readonly asn: AsnService,
    private readonly activity: ActivityLogger,
  ) {
    registerActions('asn', {
      list: (c) => this.list(c),
      detail: (c) => this.detail(c),
      create: (c) => this.create(c),
      update: (c) => this.update(c),
      cancel: (c) => this.cancel(c),
    });
    setPermission('asn', 'create', 'write');
    setPermission('asn', 'update', 'write');
    setPermission('asn', 'cancel', 'write');
    setModuleDepartments('asn', ['inbound']);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async list(ctx: RequestContext): Promise<Q> {
    const perPage = Math.max(1, Number.parseInt(ctx.query.per_page ?? '50', 10) || 50);
    const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
    const offset = (page - 1) * perPage;
    const status = ctx.query.status ? String(ctx.query.status) : null;
    const total = await this.asn.countAll(status);
    const rows = await this.asn.getAll(status, perPage, offset);
    for (const r of rows) {
      r.id = Number(r.id);
      r.total_items = Number(r.total_items ?? 0);
      r.expected_qty = Number(r.expected_qty ?? 0);
    }
    return {
      rows,
      total,
      page,
      per_page: perPage,
      statuses: ['Pending', 'Received', 'Cancelled'],
    };
  }

  private async detail(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    const asn = await this.asn.getById(id);
    if (!asn) throw ApiException.notFound('ASN tidak ditemukan');
    for (const it of asn.items ?? []) {
      it.id = Number(it.id);
      it.product_id = Number(it.product_id);
      it.expected_qty = Number(it.expected_qty);
    }
    return { asn, inbound_orders: await this.asn.linkedInbounds(id) };
  }

  private async create(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) throw ApiException.badRequest('Minimal 1 item wajib diisi.');
    const id = await this.asn.create(data, ctx.user.id);
    await this.activity.log(
      'CREATE_ASN', 'asn', 'ASN', id, null,
      'Buat ASN baru, Supplier: ' + (data.supplier_name ?? '—') + ', Ref: ' + (data.supplier_reference ?? '—'),
      null, null, this.actCtx(ctx),
    );
    const asn = await this.asn.getById(id);
    return { id, asn_number: asn?.asn_number ?? null };
  }

  private async update(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('ID wajib diisi');
    await this.asn.update(id, data);
    await this.activity.log('UPDATE_ASN', 'asn', 'ASN', id, null, 'Edit ASN ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async cancel(ctx: RequestContext): Promise<Q> {
    const data = ctx.body;
    const id = Number.parseInt(data.id ?? ctx.query.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('ID wajib diisi');
    await this.asn.cancel(id);
    await this.activity.log('CANCEL_ASN', 'asn', 'ASN', id, null, 'Batalkan ASN ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }
}