import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  PlayCircle,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  PackageOpen,
  FileSpreadsheet,
} from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { fmtDate, fmtNum } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput } from '@/components/Field';

interface StockTakeItem {
  id: number;
  product_code?: string;
  product_name?: string;
  batch_number?: string;
  uom?: string;
  location?: string;
  qty_system?: number | null;
  counter_1?: number | null;
  counter_2?: number | null;
  counter_3?: number | null;
  qty_physical?: number | null;
  difference?: number | null;
  status?: string;
  notes?: string;
  counter_by?: string;
}

interface CounterRow {
  c1: string;
  c2: string;
  c3: string;
}

interface ProductResult {
  id: number;
  text?: string;
  product_code?: string;
  product_name?: string;
  uom?: string;
}

export default function StockTakeDetail() {
  const { id } = useParams<{ id: string }>();
  const { canWrite, canAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [stockTake, setStockTake] = useState<any>(null);
  const [items, setItems] = useState<StockTakeItem[]>([]);
  const [accuracy, setAccuracy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [counters, setCounters] = useState<Record<number, CounterRow>>({});
  const [physicals, setPhysicals] = useState<Record<number, string>>({});

  const [addOpen, setAddOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState<ProductResult[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
  const [location, setLocation] = useState('');
  const [batch, setBatch] = useState('');
  const [qtySystem, setQtySystem] = useState('');
  const [qtyPhysical, setQtyPhysical] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('stocktake', 'detail', { params: { id } });
      setStockTake(res.stock_take || null);
      setAccuracy(res.accuracy || null);
      const list = res.items || [];
      setItems(list);
      const c: Record<number, CounterRow> = {};
      const p: Record<number, string> = {};
      list.forEach((it: StockTakeItem) => {
        c[it.id] = {
          c1: it.counter_1 != null ? String(it.counter_1) : '',
          c2: it.counter_2 != null ? String(it.counter_2) : '',
          c3: it.counter_3 != null ? String(it.counter_3) : '',
        };
        p[it.id] = it.qty_physical != null ? String(it.qty_physical) : '';
      });
      setCounters(c);
      setPhysicals(p);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat detail stock take');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!addOpen || !searchQ.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api('inbound', 'search_products', { params: { q: searchQ.trim() } });
        setResults(res.results || []);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, addOpen]);

  useEffect(() => {
    if (!selectedProduct || !location.trim()) return;
    const t = setTimeout(async () => {
      try {
        const res = await api('stocktake', 'get_stock', {
          params: { product_id: selectedProduct, location: location.trim() },
        });
        const tq = res.total_qty != null ? String(res.total_qty) : '';
        setQtySystem(tq);
        setQtyPhysical((prev) => (prev === '' ? tq : prev));
      } catch {
        // ignore — user may not have stock there yet
      }
    }, 400);
    return () => clearTimeout(t);
  }, [selectedProduct, location]);

  const run = async (fn: () => Promise<any>, successMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', successMsg);
      await load();
    } catch (err: any) {
      toast('error', err.message || 'Operasi gagal');
    } finally {
      setBusy(false);
    }
  };

  const buildCounters = () => {
    const out: Record<number, { c1: number | null; c2: number | null; c3: number | null }> = {};
    items.forEach((it) => {
      const e = counters[it.id] || { c1: '', c2: '', c3: '' };
      const num = (v: string) => (v === '' || v == null ? null : Number(v));
      out[it.id] = { c1: num(e.c1), c2: num(e.c2), c3: num(e.c3) };
    });
    return out;
  };

  const buildPhysicals = () => {
    const out: Record<number, number> = {};
    items.forEach((it) => {
      const v = physicals[it.id];
      out[it.id] = v === '' || v == null ? Number(it.qty_physical ?? 0) : Number(v);
    });
    return out;
  };

  const setCounter = (itemId: number, key: 'c1' | 'c2' | 'c3', value: string) => {
    setCounters((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || { c1: '', c2: '', c3: '' }), [key]: value },
    }));
  };

  const openAdd = () => {
    setSearchQ('');
    setResults([]);
    setSelectedProduct(null);
    setLocation('');
    setBatch('');
    setQtySystem('');
    setQtyPhysical('');
    setAddOpen(true);
  };

  const handleAddItem = async () => {
    if (!selectedProduct) {
      toast('error', 'Pilih produk terlebih dahulu');
      return;
    }
    const sys = qtySystem === '' ? 0 : Number(qtySystem);
    const phys = qtyPhysical === '' ? sys : Number(qtyPhysical);
    setAdding(true);
    try {
      await api('stocktake', 'add_item', {
        body: {
          stock_take_id: Number(id),
          item: {
            product_id: selectedProduct,
            batch_number: batch || undefined,
            location: location || undefined,
            qty_system: sys,
            qty_physical: phys,
          },
        },
      });
      toast('success', 'Item ditambahkan');
      setAddOpen(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menambah item');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteItem = async (item: StockTakeItem) => {
    try {
      await api('stocktake', 'delete_item', { body: { item_id: item.id } });
      toast('success', 'Item dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus item');
    }
  };

  const handleDeleteTake = async () => {
    try {
      await api('stocktake', 'delete', { body: { id } });
      toast('success', 'Stock take dihapus');
      navigate('/stocktake');
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus stock take');
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Stock Take" />
        <Spinner label="Loading detail…" />
      </div>
    );
  }

  if (!stockTake) {
    return (
      <div>
        <PageHeader title="Stock Take" />
        <Card>
          <EmptyState message="Stock take tidak ditemukan" />
        </Card>
      </div>
    );
  }

  const status = stockTake.status || '';
  const hasC2 = items.some((it) => {
    const c = counters[it.id]?.c2;
    return c !== '' && c != null;
  });

  const actions = (
    <>
      <button
        onClick={() => navigate('/stocktake')}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
      >
        <ArrowLeft className="w-4 h-4" /> Kembali
      </button>

      {canWrite && status === 'Draft' && (
        <>
          <button
            disabled={busy}
            onClick={() => run(() => api('stocktake', 'start_counting', { body: { id } }), 'Counting dimulai')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 hover:bg-brand-50 text-sm font-semibold disabled:opacity-60"
          >
            <PlayCircle className="w-4 h-4" /> Start Counting
          </button>
          <button
            disabled={busy}
            onClick={() => run(() => api('stocktake', 'auto_load', { body: { stock_take_id: Number(id) } }), 'Stok dimuat otomatis')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20 disabled:opacity-60"
          >
            <LoaderCircle className="w-4 h-4" /> Auto Load
          </button>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
          >
            <Plus className="w-4 h-4" /> Add Item
          </button>
          <ConfirmButton label="Hapus" confirmText="Hapus seluruh stock take ini?" onConfirm={handleDeleteTake} />
        </>
      )}

      {canWrite && status === 'Counting' && (
        <>
          <button
            disabled={busy}
            onClick={() => run(() => api('stocktake', 'save_counters', { body: { id, counters: buildCounters() } }), 'Counter tersimpan')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20 disabled:opacity-60"
          >
            <Save className="w-4 h-4" /> Save Counters
          </button>
          <button
            disabled={busy}
            onClick={() => run(() => api('stocktake', 'advance_to_c2', { body: { id, counters: buildCounters() } }), 'Lanjut ke round C2')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 hover:bg-brand-50 text-sm font-semibold disabled:opacity-60"
          >
            <PlayCircle className="w-4 h-4" /> Advance to C2
          </button>
          {hasC2 && (
            <button
              disabled={busy}
              onClick={() => run(() => api('stocktake', 'finish_counting', { body: { id, counters: buildCounters() } }), 'Counting selesai')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 hover:bg-brand-50 text-sm font-semibold disabled:opacity-60"
            >
              <PackageOpen className="w-4 h-4" /> Finish Counting
            </button>
          )}
        </>
      )}

      {canWrite && status === 'Review' && (
        <button
          disabled={busy}
          onClick={() => run(() => api('stocktake', 'save_review', { body: { id, physicals: buildPhysicals() } }), 'Review tersimpan')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 hover:bg-brand-50 text-sm font-semibold disabled:opacity-60"
        >
          <Save className="w-4 h-4" /> Save Review
        </button>
      )}

      {canAdmin && status === 'Review' && (
        <ConfirmButton
          label="Apply Adjustment"
          confirmText="Terapkan penyesuaian stok ke sistem? Ini tidak bisa dibatalkan."
          onConfirm={() => run(() => api('stocktake', 'apply_adjustment', { body: { id } }), 'Adjustment diterapkan')}
        />
      )}

      <WebBtn
        href={apiHref('export', 'stocktake', { id: stockTake.id })}
        label="Export Excel"
        tone="dark"
        icon={<FileSpreadsheet className="w-4 h-4" />}
      />
      <button
        onClick={load}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
      >
        <RefreshCw className="w-4 h-4" /> Refresh
      </button>
    </>
  );

  const acc = accuracy || {};
  const accItems = [
    { label: 'Total Items', value: fmtNum(acc.total_stock_take, 0) },
    { label: 'Plus', value: fmtNum(acc.plus, 0) },
    { label: 'Minus', value: fmtNum(acc.minus, 0) },
    { label: 'Clear', value: fmtNum(acc.clear, 0) },
    { label: 'Accuracy', value: `${fmtNum(acc.accuracy, 1)}%` },
  ];

  return (
    <div>
      <PageHeader title={`${stockTake.take_number || `Stock Take #${stockTake.id}`} `} subtitle={`Status: ${status}`} actions={actions} />

      <Card title="Informasi">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Status</div>
            <StatusBadge status={status} />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Take Date</div>
            <div className="text-sm font-medium text-gray-800">{fmtDate(stockTake.take_date)}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Created By</div>
            <div className="text-sm font-medium text-gray-800">{stockTake.created_by_name || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Notes</div>
            <div className="text-sm text-gray-800">{stockTake.notes || '—'}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        {accItems.map((a) => (
          <div key={a.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">{a.label}</div>
            <div className={`text-xl font-extrabold ${a.label === 'Plus' ? 'text-emerald-600' : a.label === 'Minus' ? 'text-red-600' : 'text-brand-700'}`}>
              {a.value}
            </div>
          </div>
        ))}
      </div>

      <Card title="Items">
        {items.length === 0 ? (
          <EmptyState message="Belum ada item" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-brand-50">
                <tr>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Product</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Batch</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">UOM</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Location</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Qty System</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">C1</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">C2</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">C3</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Qty Physical</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Diff</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Status</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Notes</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Counter By</th>
                  {canWrite && <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const c = counters[item.id] || { c1: '', c2: '', c3: '' };
                  const physRaw = physicals[item.id];
                  const physNum = physRaw === '' ? item.qty_physical : Number(physRaw);
                  const diff = item.difference != null ? item.difference : item.qty_system != null && physNum != null ? physNum - item.qty_system : null;
                  const counting = status === 'Counting' && canWrite;
                  const reviewing = status === 'Review' && canWrite;
                  const diffColor =
                    diff == null ? '' : diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-gray-600';
                  return (
                    <tr key={item.id} className="hover:bg-brand-50 transition-colors align-middle">
                      <td className="px-3 py-2.5 border-t border-gray-100">
                        <div className="text-sm font-semibold text-gray-800">{item.product_code || '—'}</div>
                        <div className="text-xs text-gray-500">{item.product_name || ''}</div>
                      </td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-sm text-gray-700">{item.batch_number || '—'}</td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-sm text-gray-700">{item.uom || '—'}</td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-sm text-gray-700">{item.location || '—'}</td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-sm text-gray-700 text-right">{fmtNum(item.qty_system)}</td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-right">
                        {counting ? (
                          <TextInput type="number" value={c.c1} onChange={(e) => setCounter(item.id, 'c1', e.target.value)} className="w-20 text-right" />
                        ) : (
                          <span className="text-sm text-gray-700">{c.c1 === '' ? '—' : fmtNum(c.c1)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-right">
                        {counting ? (
                          <TextInput type="number" value={c.c2} onChange={(e) => setCounter(item.id, 'c2', e.target.value)} className="w-20 text-right" />
                        ) : (
                          <span className="text-sm text-gray-700">{c.c2 === '' ? '—' : fmtNum(c.c2)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-right">
                        {counting ? (
                          <TextInput type="number" value={c.c3} onChange={(e) => setCounter(item.id, 'c3', e.target.value)} className="w-20 text-right" />
                        ) : (
                          <span className="text-sm text-gray-700">{c.c3 === '' ? '—' : fmtNum(c.c3)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-right">
                        {reviewing ? (
                          <TextInput
                            type="number"
                            value={physRaw}
                            onChange={(e) => setPhysicals((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            className="w-24 text-right"
                          />
                        ) : (
                          <span className="text-sm text-gray-700">{fmtNum(physNum)}</span>
                        )}
                      </td>
                      <td className={`px-3 py-2.5 border-t border-gray-100 text-sm text-right font-semibold ${diffColor}`}>
                        {diff == null ? '—' : diff > 0 ? `+${fmtNum(diff)}` : fmtNum(diff)}
                      </td>
                      <td className="px-3 py-2.5 border-t border-gray-100">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-sm text-gray-600 max-w-[140px] truncate">{item.notes || '—'}</td>
                      <td className="px-3 py-2.5 border-t border-gray-100 text-sm text-gray-700">{item.counter_by || '—'}</td>
                      {canWrite && (
                        <td className="px-3 py-2.5 border-t border-gray-100 text-right">
                          <ConfirmButton label="Hapus" confirmText="Hapus item dari stock take?" onConfirm={() => handleDeleteItem(item)} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Item" size="lg">
        <div className="space-y-4">
          <Field label="Cari Produk" hint="Cari berdasarkan kode atau nama produk.">
            <TextInput
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Ketik untuk mencari…"
              autoFocus
            />
          </Field>
          {results.length > 0 && (
            <div className="border border-gray-200 rounded-lg max-h-44 overflow-y-auto divide-y divide-gray-100">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedProduct(p.id);
                    setResults([]);
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-brand-50 ${selectedProduct === p.id ? 'bg-brand-50' : ''}`}
                >
                  <div className="text-sm font-semibold text-gray-800">{p.product_code}</div>
                  <div className="text-xs text-gray-500">{p.product_name}</div>
                </button>
              ))}
            </div>
          )}
          {selectedProduct ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-50 border border-brand-100 text-sm text-brand-800">
              <span className="font-semibold">Produk dipilih:</span> {searchQ}
            </div>
          ) : (
            searchQ.trim() && results.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-2">Tidak ada hasil</div>
            )
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Location">
              <TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Contoh: A-01-01" />
            </Field>
            <Field label="Batch">
              <TextInput value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Batch number (opsional)" />
            </Field>
            <Field label="Qty System" hint="Diisi otomatis dari stok sistem.">
              <TextInput type="number" min={0} value={qtySystem} onChange={(e) => setQtySystem(e.target.value)} />
            </Field>
            <Field label="Qty Physical">
              <TextInput type="number" min={0} value={qtyPhysical} onChange={(e) => setQtyPhysical(e.target.value)} />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={adding}
              onClick={handleAddItem}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-60"
            >
              <Plus className="w-4 h-4" /> {adding ? 'Menambah…' : 'Tambah Item'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
