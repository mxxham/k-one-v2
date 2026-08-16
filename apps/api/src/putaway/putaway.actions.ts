import { Injectable } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext, setPermission, setModuleDepartments, setActionDepartments } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';
import { HtmlLabelPrinterService } from './label-printer.service';

type Q = Record<string, any>;

@Injectable()
export class PutawayActions {
  constructor(
    private readonly putaway: PutawayService,
    private readonly activity: ActivityLogger,
    private readonly printer: HtmlLabelPrinterService,
  ) {
    registerActions('putaway', {
      recommend: (c) => this.recommend(c),
      validate: (c) => this.validate(c),
      zones: (c) => this.zones(c),
      save_zone: (c) => this.saveZone(c),
      delete_zone: (c) => this.deleteZone(c),
      zone_aisles: (c) => this.zoneAisles(c),
      save_zone_aisle: (c) => this.saveZoneAisle(c),
      delete_zone_aisle: (c) => this.deleteZoneAisle(c),
      uom_limits: (c) => this.uomLimits(c),
      save_uom_limit: (c) => this.saveUomLimit(c),
      product_rules: (c) => this.productRules(c),
      save_product_rule: (c) => this.saveProductRule(c),
      delete_product_rule: (c) => this.deleteProductRule(c),
      aisle_map: (c) => this.aisleMap(c),
      bins: (c) => this.bins(c),
      list_blocks: (c) => this.listBlocks(c),
      create_block: (c) => this.createBlock(c),
      deactivate_block: (c) => this.deactivateBlock(c),
      task_list: (c) => this.taskList(c),
      task_detail: (c) => this.taskDetail(c),
      task_assign: (c) => this.taskAssign(c),
      task_update_pallet: (c) => this.taskUpdatePallet(c),
      task_complete_pallet: (c) => this.taskCompletePallet(c),
      task_complete: (c) => this.taskComplete(c),
      task_cancel: (c) => this.taskCancel(c),
      assignable_users: (c) => this.assignableUsers(c),
      assign_task: (c) => this.assignTask(c),
      unassign_task: (c) => this.unassignTask(c),
      get_lpn_label_data: (c) => this.getLpnLabelData(c),
      print_lpn_label: (c) => this.printLpnLabel(c),
      my_tasks: (c) => this.myTasks(c),
      scan_override: (c) => this.scanOverride(c),
    });
    setPermission('putaway', 'save_zone', 'write');
    setPermission('putaway', 'delete_zone', 'admin');
    setPermission('putaway', 'save_zone_aisle', 'write');
    setPermission('putaway', 'delete_zone_aisle', 'write');
    setPermission('putaway', 'save_uom_limit', 'write');
    setPermission('putaway', 'save_product_rule', 'write');
    setPermission('putaway', 'delete_product_rule', 'write');
    // Putaway location blocking — writes are admin-only (they change where the
    // engine may / may not place stock); reads are open. Restricted to the
    // 'all' department, matching the Zoning admin screen that manages them.
    setPermission('putaway', 'create_block', 'admin');
    setPermission('putaway', 'deactivate_block', 'admin');
    setActionDepartments('putaway', 'list_blocks', ['all']);
    setActionDepartments('putaway', 'create_block', ['all']);
    setActionDepartments('putaway', 'deactivate_block', ['all']);
    // S43: ops (Operations) department — handheld menu set for putaway
    // operators — is granted the whole putaway module alongside inbound/
    // inventory.
    setModuleDepartments('putaway', ['inbound', 'inventory', 'ops']);
    // Putaway task queue — task reads are open (any), mutations are write ops.
    setPermission('putaway', 'task_assign', 'write');
    setPermission('putaway', 'task_update_pallet', 'write');
    setPermission('putaway', 'task_complete_pallet', 'write');
    setPermission('putaway', 'task_complete', 'write');
    setPermission('putaway', 'task_cancel', 'write');
    // Strict role split (user-confirmed): the checklist partner — who can be
    // from ANY active department (S49) — confirms each pallet on the mobile
    // screen via the LPN + bin dual-scan, so task_complete_pallet is lifted to
    // any department like my_tasks / scan_override. BUT completing the task
    // (writing stock, status → Completed) is the INBOUND OPERATOR's job on the
    // desktop, so task_complete keeps the putaway module depts
    // ['inbound','inventory','ops'] — the outbound-dept partner cannot finish.
    setActionDepartments('putaway', 'task_complete_pallet', []);
    // LPN + two-person team (S49). Team mutations are write ops; label reads
    // are open within the putaway module. my_tasks / scan_override are lifted
    // to ANY department (empty override) because the checklist partner — who
    // opens their task list on the mobile screen and can be from any active
    // department — is the one who scans + may override a mismatch.
    setPermission('putaway', 'assign_task', 'write');
    setPermission('putaway', 'unassign_task', 'write');
    setPermission('putaway', 'print_lpn_label', 'write');
    setPermission('putaway', 'scan_override', 'write');
    setActionDepartments('putaway', 'my_tasks', []);
    setActionDepartments('putaway', 'scan_override', []);
  }

  private actCtx(ctx: RequestContext) {
    return { user_id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name, ip_address: ctx.raw?.ip ?? null };
  }

  private async recommend(ctx: RequestContext): Promise<Q> {
    const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    if (!productId) throw ApiException.badRequest('product_id wajib diisi.');
    const quantity = Number(ctx.query.quantity ?? 0);
    if (quantity <= 0) throw ApiException.badRequest('quantity harus lebih dari 0.');
    const result = await this.putaway.recommendLocations({
      product_id: productId,
      quantity,
      uom: ctx.query.uom ? String(ctx.query.uom) : undefined,
      uom_per_pallet: ctx.query.uom_per_pallet ? Number(ctx.query.uom_per_pallet) : undefined,
      prefer_pick: ctx.query.prefer_pick === '1' || ctx.query.prefer_pick === 'true',
      force_level: ctx.query.force_level ? String(ctx.query.force_level) : undefined,
    });
    return result;
  }

  private async validate(ctx: RequestContext): Promise<Q> {
    const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    const location = String(ctx.query.location ?? '').trim().toUpperCase();
    const uom = String(ctx.query.uom ?? 'Drum');
    const qty = Number(ctx.query.quantity ?? 0);
    if (!productId || !location) throw ApiException.badRequest('product_id dan location wajib diisi.');
    const result = await this.putaway.validatePlacement(productId, location, qty, uom);
    return { ...result };
  }

  private async zones(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listZones() };
  }

  private async saveZone(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = await this.putaway.saveZone(d);
    await this.activity.log(
      'SAVE_ZONE', 'putaway', 'Zone', id, d.zone_code ?? null,
      `Simpan zone ${d.zone_code ?? ''} (${d.zone_type ?? ''})`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async deleteZone(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
    const ok = await this.putaway.deleteZone(id);
    if (!ok) throw ApiException.notFound('Zone tidak ditemukan.');
    await this.activity.log('DELETE_ZONE', 'putaway', 'Zone', id, null, 'Hapus zone ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async zoneAisles(ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listZoneAisles() };
  }

  private async saveZoneAisle(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = await this.putaway.saveZoneAisle(d);
    await this.activity.log(
      'SAVE_ZONE_AISLE', 'putaway', 'ZoneAisle', id, null,
      `Simpan binding zone ${d.zone_code ?? ''} aisle ${d.aisle ?? ''} (${d.min_level ?? 'A'}–${d.max_level ?? 'E'})`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async deleteZoneAisle(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
    const ok = await this.putaway.deleteZoneAisle(id);
    if (!ok) throw ApiException.notFound('Binding zone-aisle tidak ditemukan.');
    await this.activity.log('DELETE_ZONE_AISLE', 'putaway', 'ZoneAisle', id, null, 'Hapus binding zone-aisle ID ' + id, null, null, this.actCtx(ctx));
    return { id };
  }

  private async aisleMap(ctx: RequestContext): Promise<Q> {
    const aisle = ctx.query.aisle ? String(ctx.query.aisle).toUpperCase() : null;
    const level = ctx.query.level ? String(ctx.query.level).toUpperCase() : null;
    return await this.putaway.listAisleMap(aisle, level);
  }

  private async bins(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listAllBins() };
  }

  private async uomLimits(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listUomLimits() };
  }

  private async saveUomLimit(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const uomType = await this.putaway.saveUomLimit(d);
    await this.activity.log(
      'SAVE_UOM_LIMIT', 'putaway', 'UomLimit', null, uomType,
      `Simpan batas level UOM ${uomType}`,
      null, null, this.actCtx(ctx),
    );
    return { uom_type: uomType };
  }

  private async productRules(ctx: RequestContext): Promise<Q> {
    const productId = Number.parseInt(ctx.query.product_id ?? '0', 10) || 0;
    return { rows: await this.putaway.listProductRules(productId || null) };
  }

  private async saveProductRule(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const productId = await this.putaway.saveProductRule(d);
    await this.activity.log(
      'SAVE_PRODUCT_PUTAWAY_RULE', 'putaway', 'ProductPutawayRule', productId, null,
      `Simpan aturan putaway produk #${productId}`,
      null, null, this.actCtx(ctx),
    );
    return { product_id: productId };
  }

  private async deleteProductRule(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const productId = Number.parseInt(d.product_id ?? ctx.query.product_id ?? '0', 10) || 0;
    const ok = await this.putaway.deleteProductRule(productId);
    if (!ok) throw ApiException.notFound('Aturan produk tidak ditemukan.');
    await this.activity.log('DELETE_PRODUCT_PUTAWAY_RULE', 'putaway', 'ProductPutawayRule', productId, null, 'Hapus aturan putaway produk #' + productId, null, null, this.actCtx(ctx));
    return { product_id: productId };
  }

  private async listBlocks(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listBlocks() };
  }

  private async createBlock(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = await this.putaway.createBlock(d, ctx.user.id);
    const target = d.scope_type === 'aisle' ? String(d.aisle_prefix ?? '').toUpperCase() : String(d.location_code ?? '').toUpperCase();
    await this.activity.log(
      'CREATE_PUTAWAY_BLOCK', 'putaway', 'PutawayLocationBlock', id, target,
      `Blokir ${d.scope_type === 'aisle' ? 'aisle ' + target : 'lokasi ' + target} untuk putaway: ${String(d.reason ?? '')}`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async deactivateBlock(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? ctx.query.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    await this.putaway.deactivateBlock(id);
    await this.activity.log(
      'DEACTIVATE_PUTAWAY_BLOCK', 'putaway', 'PutawayLocationBlock', id, null,
      'Nonaktifkan blokir lokasi putaway ID ' + id,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async taskList(ctx: RequestContext): Promise<Q> {
    const status = ctx.query.status ? String(ctx.query.status).trim() : null;
    const search = ctx.query.search ? String(ctx.query.search).trim() : null;
    // S43: mine=1 filters the queue to tasks tied to the current user — claimed
    // (assigned_to) or on the 2-person team (forklift_operator / checklist).
    const mine = String(ctx.query.mine ?? '') === '1' || String(ctx.query.mine ?? '') === 'true';
    return { rows: await this.putaway.listTasks({ status, search, mine: mine ? ctx.user.id : null }) };
  }

  private async taskDetail(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    return await this.putaway.taskDetail(id);
  }

  private async taskAssign(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    await this.putaway.assignTask(id, ctx.user.id);
    await this.activity.log(
      'TASK_ASSIGN', 'putaway', 'PutawayTask', id, null,
      `Ambil putaway task #${id} oleh ${ctx.user.username}`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async taskUpdatePallet(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const rowId = Number.parseInt(d.id ?? '0', 10) || 0;
    const location = String(d.location ?? '').trim().toUpperCase();
    if (!rowId) throw ApiException.badRequest('id wajib diisi.');
    await this.putaway.updateTaskPallet(rowId, location);
    await this.activity.log(
      'TASK_UPDATE_PALLET', 'putaway', 'PutawayTaskItem', rowId, null,
      `Ubah lokasi pallet #${rowId} → ${location}`,
      null, null, this.actCtx(ctx),
    );
    return { id: rowId };
  }

  private async taskCompletePallet(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const rowId = Number.parseInt(d.id ?? '0', 10) || 0;
    if (!rowId) throw ApiException.badRequest('id wajib diisi.');
    await this.putaway.completeTaskPallet(rowId, ctx.user.id);
    await this.activity.log(
      'TASK_COMPLETE_PALLET', 'putaway', 'PutawayTaskItem', rowId, null,
      `Pallet #${rowId} selesai diputaway oleh ${ctx.user.username}`,
      null, null, this.actCtx(ctx),
    );
    return { id: rowId };
  }

  private async taskComplete(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    const r = await this.putaway.completeTask(id, ctx.user.id);
    await this.activity.log(
      'TASK_COMPLETE', 'putaway', 'PutawayTask', id, r.task_number,
      `Putaway task ${r.task_number} selesai (${r.pallets} pallet, ${r.quantity} qty)`,
      null, null, this.actCtx(ctx),
    );
    return { ...r, id };
  }

  private async taskCancel(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    await this.putaway.cancelTask(id, ctx.user.id);
    await this.activity.log(
      'TASK_CANCEL', 'putaway', 'PutawayTask', id, null,
      `Putaway task #${id} dibatalkan oleh ${ctx.user.username}`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async assignableUsers(_ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.listAssignableUsers() };
  }

  private async assignTask(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? '0', 10) || 0;
    const fo = Number.parseInt(d.forklift_operator_id ?? '0', 10) || 0;
    const cp = Number.parseInt(d.checklist_partner_id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    await this.putaway.assignTeam(id, fo, cp);
    await this.activity.log(
      'TASK_TEAM_ASSIGN', 'putaway', 'PutawayTask', id, null,
      `Tugaskan tim putaway task #${id} → forklift #${fo}, checklist #${cp}`,
      null, { forklift_operator_id: fo, checklist_partner_id: cp }, this.actCtx(ctx),
    );
    return { id };
  }

  private async unassignTask(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    await this.putaway.unassignTeam(id);
    await this.activity.log(
      'TASK_TEAM_UNASSIGN', 'putaway', 'PutawayTask', id, null,
      `Hapus penugasan tim putaway task #${id}`,
      null, null, this.actCtx(ctx),
    );
    return { id };
  }

  private async getLpnLabelData(ctx: RequestContext): Promise<Q> {
    const id = Number.parseInt(ctx.query.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    return { label: await this.putaway.getLpnLabelData(id) };
  }

  private async printLpnLabel(ctx: RequestContext): Promise<Q> {
    const d = ctx.body;
    const id = Number.parseInt(d.id ?? '0', 10) || 0;
    if (!id) throw ApiException.badRequest('id wajib diisi.');
    const label = await this.putaway.getLpnLabelData(id);
    const res = await this.printer.printLpnLabel(label);
    await this.activity.log(
      'PRINT_LPN_LABEL', 'putaway', 'PutawayTaskItem', id, label.lpn_code,
      `Cetak label LPN ${label.lpn_code}`,
      null, null, this.actCtx(ctx),
    );
    return { message: res.message, label };
  }

  private async myTasks(ctx: RequestContext): Promise<Q> {
    return { rows: await this.putaway.myTasks(ctx.user.id) };
  }

  /** Mirror of stock::scan_override: a scan mismatch can be overridden with a typed reason. */
  private async scanOverride(ctx: RequestContext): Promise<Q> {
    const code = String(ctx.body.code ?? '').trim();
    const reason = String(ctx.body.reason ?? '').trim();
    const context = String(ctx.body.context ?? '').trim();
    if (!code) throw ApiException.badRequest('Kode wajib diisi.');
    if (!reason) throw ApiException.badRequest('Alasan override wajib diisi.');
    await this.activity.log(
      'SCAN_OVERRIDE', 'putaway', 'PutawayTaskItem', null, null,
      `Scan putaway mismatch di-override${context ? ` [${context}]` : ''}: '${code}' — ${reason}`,
      { scanned: code, context: context || null }, { reason }, this.actCtx(ctx),
    );
    return { ok: true };
  }
}