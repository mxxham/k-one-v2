import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb } from './helpers';

describe('ASN (Advance Shipping Notice)', () => {
  let token: string;
  let productId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();
    productId = Number(await createProduct({ uom_type: 'Drum' }));
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it('creates an ASN with items and lists/detail it', async () => {
    const res = await api('asn', 'create', token, {
      supplier_name: 'PT Supplier Test',
      supplier_reference: 'PO-ASN-1',
      expected_arrival_date: '2026-08-20',
      items: [
        { product_id: productId, expected_qty: 20, uom: 'Drum', batch_number: 'ASN-BATCH' },
      ],
    });
    expect(res.body.success).toBe(true);
    const asnId = Number(res.body.id);
    expect(Number(asnId)).toBeGreaterThan(0);
    expect(String(res.body.asn_number)).toMatch(/^ASN-/);

    const rows = await q('SELECT status FROM asn WHERE id = $1', [asnId]);
    expect(rows[0].status).toBe('Pending');

    const list = await api('asn', 'list', token);
    expect(list.body.rows.length).toBeGreaterThan(0);

    const detail = await api('asn', 'detail', token, {}, { id: asnId });
    expect(detail.body.asn.status).toBe('Pending');
    expect(detail.body.asn.items.length).toBe(1);
    expect(Number(detail.body.asn.items[0].expected_qty)).toBe(20);
  });

  it('rejects creating an ASN with no items', async () => {
    const res = await api('asn', 'create', token, { supplier_name: 'X', items: [] });
    expect(res.body.success).toBe(false);
    expect(res.status).toBe(400);
  });

  it('creates an inbound from an ASN and pre-fills expected items', async () => {
    const created = await api('asn', 'create', token, {
      supplier_name: 'PT Supplier Test',
      supplier_reference: 'PO-ASN-2',
      items: [{ product_id: productId, expected_qty: 12, uom: 'Drum' }],
    });
    const asnId = Number(created.body.id);

    // No items supplied -> server pre-fills from the ASN.
    const inbound = await api('inbound', 'create', token, {
      order_date: '2026-08-15',
      asn_id: asnId,
    });
    expect(inbound.body.success).toBe(true);
    const inboundId = Number(inbound.body.id);

    const linked = await q('SELECT asn_id FROM inbound_orders WHERE id = $1', [inboundId]);
    expect(Number(linked[0].asn_id)).toBe(asnId);

    const items = await q('SELECT product_id, quantity FROM inbound_items WHERE inbound_order_id = $1', [inboundId]);
    expect(items.length).toBe(1);
    expect(Number(items[0].product_id)).toBe(productId);
    expect(Number(items[0].quantity)).toBe(12);
  });

  it('blocks creating an inbound from a non-Pending ASN', async () => {
    const created = await api('asn', 'create', token, {
      supplier_name: 'X',
      items: [{ product_id: productId, expected_qty: 4 }],
    });
    const asnId = Number(created.body.id);
    await api('asn', 'cancel', token, { id: asnId });

    const inbound = await api('inbound', 'create', token, {
      order_date: '2026-08-15',
      asn_id: asnId,
    });
    expect(inbound.body.success).toBe(false);
    expect(inbound.status).toBe(409);
  });

  it('flips the ASN to Received when the linked inbound completes', async () => {
    const created = await api('asn', 'create', token, {
      supplier_name: 'PT Supplier Test',
      supplier_reference: 'PO-ASN-3',
      items: [{ product_id: productId, expected_qty: 8, uom: 'Drum' }],
    });
    const asnId = Number(created.body.id);

    const inbound = await api('inbound', 'create', token, {
      order_date: '2026-08-15',
      asn_id: asnId,
    });
    const inboundId = Number(inbound.body.id);
    const itemId = Number((await q('SELECT id FROM inbound_items WHERE inbound_order_id = $1', [inboundId]))[0].id);

    await api('inbound', 'advance_status', token, {
      id: inboundId, status: 'Receiving', received_by_id: 1, received_date: '2026-08-15',
    });
    await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'ATP', location: 'CA01A01' });
    await api('inbound', 'complete', token, { id: inboundId });

    const asn = await q('SELECT status FROM asn WHERE id = $1', [asnId]);
    expect(asn[0].status).toBe('Received');
  });

  it('allows cancel only while Pending', async () => {
    const created = await api('asn', 'create', token, {
      supplier_name: 'X',
      items: [{ product_id: productId, expected_qty: 4 }],
    });
    const asnId = Number(created.body.id);

    const cancel = await api('asn', 'cancel', token, { id: asnId });
    expect(cancel.body.success).toBe(true);
    const cancelled = await q('SELECT status FROM asn WHERE id = $1', [asnId]);
    expect(cancelled[0].status).toBe('Cancelled');

    const again = await api('asn', 'cancel', token, { id: asnId });
    expect(again.body.success).toBe(true); // cancel of Cancelled is a no-op, still 200
  });

  it('rejects updating a Received ASN', async () => {
    const created = await api('asn', 'create', token, {
      supplier_name: 'X',
      items: [{ product_id: productId, expected_qty: 5 }],
    });
    const asnId = Number(created.body.id);

    // drive straight to Received via a completed inbound
    const inbound = await api('inbound', 'create', token, { order_date: '2026-08-15', asn_id: asnId });
    const inboundId = Number(inbound.body.id);
    const itemId = Number((await q('SELECT id FROM inbound_items WHERE inbound_order_id = $1', [inboundId]))[0].id);
    await api('inbound', 'advance_status', token, { id: inboundId, status: 'Receiving', received_by_id: 1, received_date: '2026-08-15' });
    await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'ATP', location: 'CA01A01' });
    await api('inbound', 'complete', token, { id: inboundId });

    const upd = await api('asn', 'update', token, { id: asnId, supplier_name: 'Edited' });
    expect(upd.body.success).toBe(false);
    expect(upd.status).toBe(409);
  });
});
