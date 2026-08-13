import { useEffect, useRef, useState, FormEvent, ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, PackagePlus, Trash2, Printer, FileText, ClipboardList } from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { fmtNum, fmtDate, fmtDateTime } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Spinner from '@/components/Spinner';
import Modal from '@/components/Modal';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, Select, Grid } from '@/components/Field';

interface OutboundItem {
  id: number;
  product_code?: string;
  product_name?: string;
  batch_no?: string;
  batch_number?: string;
  location?: string;
  quantity?: number;
  uom?: string;
  actual_qty?: number;
  pallet?: number;
  od_number?: string;
  so_number?: string;
  destination_id?: number;
  in_process_status?: string;
  notes?: string;
  picked_locations?: any[];
}

interface DestRow {
  id: number;
  seq?: number;
  ship_to_name?: string;
  ship_to_location?: string;
  ship_to_street?: string;
  kota?: string;
  notes?: string;
}

function InfoItem({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-medium text-gray-800 mt-0.5">{value ?? '—'}</div>
    </div>
  );
}

function InProcessPill({ status }: { status?: string }) {
  const map: Record<string, string> = {
    'Goods Received': 'bg-blue-50 text-blue-700 border-blue-300',
    ATP: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    Unserviceable: 'bg-red-50 text-red-700 border-red-300',
  };
  const cls = map[status || ''] || 'bg-gray-100 text-gray-600 border-gray-300';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status || '—'}
    </span>
  );
}

function ProductSearch({ onSelect, placeholder = 'Cari produk…' }: { onSelect: (p: { id: number; product_name: string; uom?: string }) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await api('outbound', 'search_products', { params: { q: term } });
        setResults(res.results || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(t);
      setLoading(false);
    };
  }, [q]);

  return (
    <div className="relative" ref={boxRef}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 pr-8 border-[1.5px] border-gray-300 rounded-lg text-sm text-brand-900 bg-white focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 outline-none transition"
      />
      {loading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">…</span>}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect({ id: r.id, product_name: r.product_name || r.text, uom: r.uom });
                  setQ('');
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-brand-50 text-sm flex items-center justify-between gap-2"
              >
                <span className="font-medium text-gray-800">{r.product_name || r.text}</span>
                <span className="text-[11px] text-gray-400 whitespace-nowrap">{r.product_code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddItemModal({ open, onClose, outboundId, onDone }: { open: boolean; onClose: () => void; outboundId: number; onDone: () => void }) {
  const toast = useToast();
  const [productId, setProductId] = useState<number | null>(null);
  const [productName, setProductName] = useState('');
  const [uom, setUom] = useState('');
  const [quantity, setQuantity] = useState('');
  const [available, setAvailable] = useState<number | null>(null);
  const [odNumber, setOdNumber] = useState('');
  const [soNumber, setSoNumber] = useState('');
  const [shipToName, setShipToName] = useState('');
  const [shipToLocation, setShipToLocation] = useState('');
  const [shipToStreet, setShipToStreet] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProductId(null);
    setProductName('');
    setUom('');
    setQuantity('');
    setAvailable(null);
    setOdNumber('');
    setSoNumber('');
    setShipToName('');
    setShipToLocation('');
    setShipToStreet('');
  }, [open]);

  useEffect(() => {
    if (!productId || !quantity || Number(quantity) <= 0) return;
    const t = window.setTimeout(async () => {
      try {
        const res = await api('outbound', 'check_stock', { params: { product_id: productId, quantity } });
        setAvailable(typeof res.available === 'number' ? res.available : null);
      } catch {
        setAvailable(null);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [productId, quantity]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!productId) {
      toast('error', 'Pilih produk terlebih dahulu');
      return;
    }
    if (!quantity || Number(quantity) <= 0) {
      toast('error', 'Qty wajib diisi');
      return;
    }
    setSaving(true);
    try {
      await api('outbound', 'add_item', {
        body: {
          outbound_id: outboundId,
          item: {
            product_id: productId,
            quantity: Number(quantity),
            uom: uom || undefined,
            actual_qty: Number(quantity),
            od_number: odNumber || undefined,
            so_number: soNumber || undefined,
            item_ship_to_name: shipToName || undefined,
            item_ship_to_location: shipToLocation || undefined,
            item_ship_to_street: shipToStreet || undefined,
          },
        },
      });
      toast('success', 'Item berhasil ditambahkan');
      onDone();
      onClose();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menambahkan item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Item" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Grid cols={2}>
          <Field label="Product" required>
            <ProductSearch
              onSelect={(p) => {
                setProductId(p.id);
                setProductName(p.product_name);
                setUom(p.uom || '');
                setAvailable(null);
              }}
            />
            {productId && <div className="text-[11px] text-gray-500 mt-1">{productName} · UOM {uom || '—'}</div>}
          </Field>
          <Field label="Qty" required>
            <TextInput type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
          </Field>
          <Field label="UOM">
            <TextInput value={uom} onChange={(e) => setUom(e.target.value)} placeholder="drums" />
          </Field>
          <Field label="OD Number">
            <TextInput value={odNumber} onChange={(e) => setOdNumber(e.target.value)} placeholder="OD-001" />
          </Field>
          <Field label="SO Number">
            <TextInput value={soNumber} onChange={(e) => setSoNumber(e.target.value)} placeholder="SO-001" />
          </Field>
        </Grid>
        {productId && quantity && Number(quantity) > 0 && (
          <div className="text-[11px]">
            {available === null ? (
              <span className="text-gray-400">Mengecek ketersediaan stok…</span>
            ) : available >= Number(quantity) ? (
              <span className="text-emerald-600 font-semibold">✓ Available: {fmtNum(available, 0)}</span>
            ) : (
              <span className="text-red-600 font-semibold">Stok tersedia hanya {fmtNum(available, 0)}</span>
            )}
          </div>
        )}
        <div className="border-t border-gray-100 pt-4">
          <div className="text-sm font-bold text-brand-700 mb-3">Ship To (opsional)</div>
          <Grid cols={2}>
            <Field label="Ship To Name">
              <TextInput value={shipToName} onChange={(e) => setShipToName(e.target.value)} />
            </Field>
            <Field label="Ship To Location">
              <TextInput value={shipToLocation} onChange={(e) => setShipToLocation(e.target.value)} />
            </Field>
            <Field label="Ship To Street" className="md:col-span-2">
              <TextInput value={shipToStreet} onChange={(e) => setShipToStreet(e.target.value)} />
            </Field>
          </Grid>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200">
            Batal
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function OutboundDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const toast = useToast();
  const orderId = Number(id);

  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<OutboundItem[]>([]);
  const [destinations, setDestinations] = useState<DestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [statusItem, setStatusItem] = useState<OutboundItem | null>(null);
  const [newStatus, setNewStatus] = useState('Goods Received');

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const res = await api('outbound', 'detail', { params: { id: orderId } });
      setOrder(res.order || null);
      setItems(res.items || []);
      setDestinations(res.destinations || []);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId) fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const status: string = order?.status || '';

  const runMutation = async (action: string, okMessage: string, errorHint?: string) => {
    setBusy(true);
    try {
      await api('outbound', action, { body: { id: orderId } });
      toast('success', okMessage);
      await fetchDetail();
    } catch (err: any) {
      toast('error', `${err.message || 'Gagal'}` + (errorHint ? ` — ${errorHint}` : ''));
    } finally {
      setBusy(false);
    }
  };

  const handlePick = () => runMutation('pick_items', 'Picking dimulai', 'Pastikan expected date terisi pada info order.');
  const handleShip = () => runMutation('ship', 'Order berhasil di-ship');
  const handleComplete = () => runMutation('complete', 'Order berhasil di-complete');

  const handleDelete = async () => {
    setBusy(true);
    try {
      await api('outbound', 'delete', { body: { id: orderId } });
      toast('success', 'Order berhasil dihapus');
      navigate('/outbound');
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus order');
      setBusy(false);
    }
  };

  const handleChangeStatus = async () => {
    if (!statusItem) return;
    setBusy(true);
    try {
      await api('outbound', 'update_item_status', { body: { item_id: statusItem.id, outbound_id: orderId, status: newStatus } });
      toast('success', 'Status item diperbarui');
      setStatusItem(null);
      await fetchDetail();
    } catch (err: any) {
      toast('error', err.message || 'Gagal memperbarui status item');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    setBusy(true);
    try {
      await api('outbound', 'delete_item', { body: { outbound_id: orderId, item_id: itemId } });
      toast('success', 'Item berhasil dihapus');
      await fetchDetail();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus item');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !order) {
    return <Spinner label="Memuat detail order…" />;
  }

  if (!order) {
    return <EmptyState message="Order tidak ditemukan" />;
  }

  const deletable = ['Open', 'Picking', 'Picked'].includes(status);

  return (
    <div>
      <PageHeader
        title={order.order_number || `Order #${orderId}`}
        subtitle={order.display_order_no ? `Display No: ${order.display_order_no}` : undefined}
        actions={
          <>
            <StatusBadge status={order.status} />
            <WebBtn href={apiHref('print', 'outbound_do', { id: orderId })} label="DO" icon={<Printer className="w-4 h-4" />} />
            <WebBtn href={apiHref('print', 'surat_jalan', { id: orderId })} label="Surat Jalan" icon={<FileText className="w-4 h-4" />} />
            <WebBtn href={apiHref('print', 'picklist', { outbound_id: orderId })} label="Picklist PDF" icon={<ClipboardList className="w-4 h-4" />} />
            {canWrite && status === 'Open' && (
              <button
                onClick={handlePick}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold shadow hover:bg-brand-50 disabled:opacity-60"
              >
                <PackagePlus className="w-4 h-4" /> Pick Items
              </button>
            )}
            {canWrite && (status === 'Picking' || status === 'Picked') && (
              <button
                onClick={handleShip}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold shadow hover:bg-brand-50 disabled:opacity-60"
              >
                Ship
              </button>
            )}
            {canWrite && status === 'Shipped' && (
              <button
                onClick={handleComplete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold shadow hover:bg-brand-50 disabled:opacity-60"
              >
                Complete
              </button>
            )}
            {canWrite && deletable && <ConfirmButton label="Hapus Order" onConfirm={handleDelete} disabled={busy} />}
            <button
              onClick={() => navigate('/outbound')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 text-white text-sm font-semibold hover:bg-white/25"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </>
        }
      />

      <Card title="Info Order">
        <Grid cols={3}>
          <InfoItem label="Customer" value={order.customer_name || '—'} />
          <InfoItem label="SO Number" value={order.so_number || '—'} />
          <InfoItem label="DO Number" value={order.do_number || '—'} />
          <InfoItem label="Shipment Number" value={order.shipment_number || '—'} />
          <InfoItem label="Destination" value={order.destination || '—'} />
          <InfoItem label="Kota" value={order.kota || '—'} />
          <InfoItem label="Armada No" value={order.armada_no || '—'} />
          <InfoItem label="Container No" value={order.container_no || '—'} />
          <InfoItem label="Jenis Armada" value={order.jenis_armada || '—'} />
          <InfoItem label="Expected Date" value={fmtDate(order.expected_date)} />
          <InfoItem label="Shipped Date" value={order.shipped_date ? fmtDateTime(order.shipped_date) : '—'} />
          <InfoItem label="Created By" value={order.created_by_name || '—'} />
          <InfoItem label="Notes" value={order.notes || '—'} />
        </Grid>
      </Card>

      {destinations.length > 0 && (
        <Card title="Destinations">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-50 text-left text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 font-bold">#</th>
                  <th className="px-3 py-2.5 font-bold">Ship To Name</th>
                  <th className="px-3 py-2.5 font-bold">Ship To Location</th>
                  <th className="px-3 py-2.5 font-bold">Ship To Street</th>
                  <th className="px-3 py-2.5 font-bold">Kota</th>
                  <th className="px-3 py-2.5 font-bold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((d) => (
                  <tr key={d.id} className="table-row border-b border-gray-100">
                    <td className="px-3 py-2.5 text-gray-500">{d.seq ?? d.id}</td>
                    <td className="px-3 py-2.5 text-gray-800 font-medium">{d.ship_to_name || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{d.ship_to_location || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{d.ship_to_street || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{d.kota || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{d.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="Items"
        actions={
          canWrite && (
            <button
              onClick={() => setAddItemOpen(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700"
            >
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          )
        }
      >
        {items.length === 0 ? (
          <EmptyState message="Belum ada item" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-50 text-left text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 font-bold">Product</th>
                  <th className="px-3 py-2.5 font-bold">OD No</th>
                  <th className="px-3 py-2.5 font-bold">SO No</th>
                  <th className="px-3 py-2.5 font-bold">Batch No</th>
                  <th className="px-3 py-2.5 font-bold">Location</th>
                  <th className="px-3 py-2.5 font-bold text-right">Qty</th>
                  <th className="px-3 py-2.5 font-bold">UOM</th>
                  <th className="px-3 py-2.5 font-bold text-right">Actual Qty</th>
                  <th className="px-3 py-2.5 font-bold text-right">Pallet</th>
                  <th className="px-3 py-2.5 font-bold">In Process</th>
                  <th className="px-3 py-2.5 font-bold">Picked Locations</th>
                  {canWrite && <th className="px-3 py-2.5 font-bold text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="table-row border-b border-gray-100">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-gray-800">{it.product_name || '—'}</div>
                      {it.product_code && <div className="text-[11px] text-gray-400">{it.product_code}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{it.od_number || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{it.so_number || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{it.batch_number || it.batch_no || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{it.location || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700 text-right font-medium">{fmtNum(it.quantity, 0)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{it.uom || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700 text-right">{fmtNum(it.actual_qty, 0)}</td>
                    <td className="px-3 py-2.5 text-gray-600 text-right">{fmtNum(it.pallet, 0)}</td>
                    <td className="px-3 py-2.5">
                      <InProcessPill status={it.in_process_status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(it.picked_locations || []).length === 0 && <span className="text-gray-400 text-xs">—</span>}
                        {(it.picked_locations || []).map((p: any, i: number) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 text-[11px] font-semibold border border-brand-100"
                          >
                            {p.location_code ?? p}@{p.qty ?? p.quantity ?? ''}
                          </span>
                        ))}
                      </div>
                    </td>
                    {canWrite && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              const cur = it.in_process_status || '';
                              setNewStatus(['Goods Received', 'ATP', 'Unserviceable'].includes(cur) ? cur : 'Goods Received');
                              setStatusItem(it);
                            }}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100"
                          >
                            Status
                          </button>
                          <ConfirmButton label="" onConfirm={() => handleDeleteItem(it.id)} disabled={busy} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!statusItem} onClose={() => setStatusItem(null)} title="Ubah Status Item" size="sm">
        <div className="space-y-4">
          <Field label="Status">
            <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              {['Goods Received', 'ATP', 'Unserviceable'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setStatusItem(null)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200">
              Batal
            </button>
            <button
              onClick={handleChangeStatus}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
            >
              Simpan
            </button>
          </div>
        </div>
      </Modal>

      {canWrite && (
        <AddItemModal open={addItemOpen} onClose={() => setAddItemOpen(false)} outboundId={orderId} onDone={fetchDetail} />
      )}
    </div>
  );
}
