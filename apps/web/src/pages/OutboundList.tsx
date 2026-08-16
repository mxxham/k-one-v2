import { useEffect, useRef, useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Trash2, FileSpreadsheet, MapPin } from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { fmtNum, fmtDate, todayISO } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Pagination from '@/components/Pagination';
import Spinner from '@/components/Spinner';
import Modal from '@/components/Modal';
import { Field, TextInput, Select, TextArea, Grid } from '@/components/Field';

const PER_PAGE = 50;

interface OutboundRow {
  id: number;
  order_number: string;
  display_order_no?: string;
  order_date?: string;
  customer_id?: number;
  customer_name?: string;
  so_number?: string;
  do_number?: string;
  shipment_number?: string;
  destination?: string;
  kota?: string;
  armada_no?: string;
  container_no?: string;
  jenis_armada?: string;
  expected_date?: string;
  status?: string;
  shipped_date?: string;
  created_by_name?: string;
  total_items?: number;
  total_qty?: number;
  total_pallet?: number;
  join?: { customer_name?: string };
}

interface DraftItem {
  key: number;
  product_id: number | null;
  product_code: string;
  product_name: string;
  uom: string;
  quantity: string;
  od_number: string;
  so_number: string;
  available: number | null;
}

interface DraftDest {
  key: number;
  ship_to_name: string;
  ship_to_location: string;
  ship_to_street: string;
  kota: string;
  notes: string;
}

const KPI_LABELS: Record<string, string> = {
  total: 'Total Orders',
  open: 'Open',
  pending_open: 'Pending Open',
  picking: 'Picking',
  picked: 'Picked',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const KPI_ORDER = ['total', 'pending_open', 'open', 'picking', 'picked', 'shipped', 'delivered', 'completed', 'cancelled'];

interface SearchProduct {
  id: number;
  product_code: string;
  product_name: string;
  uom: string;
  uom_per_pallet: number;
  stock_qty: number;
}

function ProductSearch({
  selected,
  onSelect,
  onClear,
  placeholder = 'Cari produk…',
  autoFocus,
}: {
  selected: { id: number; code: string; name: string } | null;
  onSelect: (p: SearchProduct) => void;
  onClear: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api('outbound', 'search_products', { params: { q } });
        setResults(res.results || []);
        setOpen(true);
      } catch (e: any) {
        toast('error', e.message || 'Gagal mencari produk');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (selected) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 px-3 py-2 rounded-lg bg-brand-50 border border-brand-100 text-sm">
          <div className="font-semibold text-brand-900">{selected.code}</div>
          <div className="text-[11px] text-gray-500 truncate">{selected.name}</div>
        </div>
        <button type="button" onClick={onClear} className="px-2 py-1 text-xs font-semibold text-gray-500 hover:text-red-600 flex-shrink-0">
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <TextInput
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          className="pl-9"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-brand-600 font-semibold">Searching...</span>
        )}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {results.length === 0 && !searching && <div className="px-3 py-2 text-xs text-gray-400">No products found</div>}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p);
                setOpen(false);
                setQ('');
                setResults([]);
              }}
              className="w-full text-left px-3 py-2 hover:bg-brand-50 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800">{p.product_code}</div>
                <div className="text-[11px] text-gray-500 truncate">{p.product_name}</div>
              </div>
              <div className="text-[11px] text-gray-400 flex-shrink-0">Stock: {fmtNum(p.stock_qty, 0)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftItemRow({ item, onChange, onRemove }: { item: DraftItem; onChange: (i: DraftItem) => void; onRemove: () => void }) {
  const set = (patch: Partial<DraftItem>) => onChange({ ...item, ...patch });

  useEffect(() => {
    if (!item.product_id || !item.quantity || Number(item.quantity) <= 0) return;
    const t = window.setTimeout(async () => {
      try {
        const res = await api('outbound', 'check_stock', { params: { product_id: item.product_id, quantity: item.quantity } });
        set({ available: typeof res.available === 'number' ? res.available : null });
      } catch {
        set({ available: null });
      }
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.product_id, item.quantity]);

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <Field label="Product" required>
            <ProductSearch
              selected={item.product_id ? { id: item.product_id, code: item.product_code, name: item.product_name } : null}
              onSelect={(p) => set({ product_id: p.id, product_code: p.product_code, product_name: p.product_name, uom: p.uom || '', available: null })}
              onClear={() => set({ product_id: null, product_code: '', product_name: '', uom: '', available: null })}
            />
          </Field>
          {item.product_id && <div className="text-[11px] text-gray-500 mt-1">{item.product_name} · UOM {item.uom || '—'}</div>}
        </div>
        <button type="button" onClick={onRemove} className="mt-6 p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="Hapus item">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <Grid cols={4}>
        <Field label="Qty" required>
          <TextInput type="number" min={1} value={item.quantity} onChange={(e) => set({ quantity: e.target.value })} placeholder="0" />
        </Field>
        <Field label="UOM">
          <TextInput value={item.uom} onChange={(e) => set({ uom: e.target.value })} placeholder="drums" />
        </Field>
        <Field label="OD Number">
          <TextInput value={item.od_number} onChange={(e) => set({ od_number: e.target.value })} placeholder="OD-001" />
        </Field>
        <Field label="SO Number">
          <TextInput value={item.so_number} onChange={(e) => set({ so_number: e.target.value })} placeholder="SO-001" />
        </Field>
      </Grid>
      {item.product_id && item.quantity && Number(item.quantity) > 0 && (
        <div className="text-[11px]">
          {item.available === null ? (
            <span className="text-gray-400">Mengecek ketersediaan stok…</span>
          ) : item.available >= Number(item.quantity) ? (
            <span className="text-emerald-600 font-semibold">✓ Available: {fmtNum(item.available, 0)}</span>
          ) : (
            <span className="text-red-600 font-semibold">Stok tersedia hanya {fmtNum(item.available, 0)}</span>
          )}
        </div>
      )}
    </div>
  );
}

function NewOutboundModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const toast = useToast();
  const [orderDate, setOrderDate] = useState(todayISO());
  const [customerId, setCustomerId] = useState('');
  const [soNumber, setSoNumber] = useState('');
  const [doNumber, setDoNumber] = useState('');
  const [shipmentNumber, setShipmentNumber] = useState('');
  const [destination, setDestination] = useState('');
  const [kota, setKota] = useState('');
  const [armadaNo, setArmadaNo] = useState('');
  const [containerNo, setContainerNo] = useState('');
  const [jenisArmada, setJenisArmada] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [status, setStatus] = useState('Open');
  const [notes, setNotes] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [destinations, setDestinations] = useState<DraftDest[]>([]);
  const [saving, setSaving] = useState(false);

  const newItem = (): DraftItem => ({ key: Date.now() + Math.random(), product_id: null, product_code: '', product_name: '', uom: '', quantity: '', od_number: '', so_number: '', available: null });
  const newDest = (): DraftDest => ({ key: Date.now() + Math.random(), ship_to_name: '', ship_to_location: '', ship_to_street: '', kota: '', notes: '' });

  useEffect(() => {
    if (!open) return;
    setOrderDate(todayISO());
    setCustomerId('');
    setSoNumber('');
    setDoNumber('');
    setShipmentNumber('');
    setDestination('');
    setKota('');
    setArmadaNo('');
    setContainerNo('');
    setJenisArmada('');
    setExpectedDate('');
    setStatus('Open');
    setNotes('');
    setItems([newItem()]);
    setDestinations([newDest()]);
    api('customers', 'all')
      .then((res) => setCustomers(res.rows || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!orderDate) {
      toast('error', 'Tanggal order wajib diisi');
      return;
    }
    const validItems = items.filter((it) => it.product_id);
    if (!validItems.length) {
      toast('error', 'Tambahkan minimal 1 item');
      return;
    }
    setSaving(true);
    try {
      const res = await api('outbound', 'create', {
        body: {
          order_date: orderDate,
          customer_id: customerId ? Number(customerId) : undefined,
          so_number: soNumber || undefined,
          do_number: doNumber || undefined,
          shipment_number: shipmentNumber || undefined,
          destination: destination || undefined,
          kota: kota || undefined,
          armada_no: armadaNo || undefined,
          container_no: containerNo || undefined,
          jenis_armada: jenisArmada || undefined,
          expected_date: expectedDate || undefined,
          status: status || undefined,
          notes: notes || undefined,
          items: validItems.map((it) => ({
            product_id: it.product_id as number,
            quantity: Number(it.quantity),
            uom: it.uom || undefined,
            actual_qty: Number(it.quantity),
            od_number: it.od_number || undefined,
            so_number: it.so_number || undefined,
          })),
          destinations: destinations
            .filter((d) => d.ship_to_name || d.ship_to_location || d.ship_to_street || d.kota || d.notes)
            .map((d) => ({
              ship_to_name: d.ship_to_name || undefined,
              ship_to_location: d.ship_to_location || undefined,
              ship_to_street: d.ship_to_street || undefined,
              kota: d.kota || undefined,
              notes: d.notes || undefined,
            })),
        },
      });
      if (res.warnings && res.warnings.length) {
        res.warnings.forEach((w: string) => toast('info', w));
      }
      toast('success', 'Outbound order berhasil dibuat');
      onCreated(res.id);
    } catch (err: any) {
      toast('error', err.message || 'Gagal membuat outbound order');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Outbound" size="xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="border border-gray-200 rounded-lg p-4 space-y-4">
          <div className="text-sm font-bold text-brand-700">Order</div>
          <Grid cols={4}>
            <Field label="Order Date" required>
              <TextInput type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </Field>
            <Field label="Customer">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— Pilih Customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customer_code ? `${c.customer_code} — ` : ''}
                    {c.customer_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="SO Number">
              <TextInput value={soNumber} onChange={(e) => setSoNumber(e.target.value)} placeholder="SO-001" />
            </Field>
            <Field label="DO Number">
              <TextInput value={doNumber} onChange={(e) => setDoNumber(e.target.value)} placeholder="DO-001" />
            </Field>
            <Field label="Shipment Number">
              <TextInput value={shipmentNumber} onChange={(e) => setShipmentNumber(e.target.value)} placeholder="SHP-001" />
            </Field>
            <Field label="Destination">
              <TextInput value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Alamat tujuan" />
            </Field>
            <Field label="Kota">
              <TextInput value={kota} onChange={(e) => setKota(e.target.value)} placeholder="Kota" />
            </Field>
            <Field label="Armada No">
              <TextInput value={armadaNo} onChange={(e) => setArmadaNo(e.target.value)} placeholder="B 1234 CD" />
            </Field>
            <Field label="Container No">
              <TextInput value={containerNo} onChange={(e) => setContainerNo(e.target.value)} placeholder="XXXX-000" />
            </Field>
            <Field label="Jenis Armada">
              <TextInput value={jenisArmada} onChange={(e) => setJenisArmada(e.target.value)} placeholder="Truk / Kontainer" />
            </Field>
            <Field label="Expected Date">
              <TextInput type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {['Open', 'Picking', 'Picked', 'Shipped', 'Completed', 'Cancelled'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes" className="md:col-span-2">
              <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Catatan" />
            </Field>
          </Grid>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-brand-700">Destinations</div>
            <button
              type="button"
              onClick={() => setDestinations((prev) => [...prev, newDest()])}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-xs font-semibold hover:bg-brand-100"
            >
              <Plus className="w-3.5 h-3.5" /> Tambah
            </button>
          </div>
          {destinations.map((d, idx) => (
            <div key={d.key} className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-gray-400 uppercase">Destination {idx + 1}</div>
                <button type="button" onClick={() => setDestinations((prev) => prev.filter((x) => x.key !== d.key))} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="Hapus">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <Grid cols={2}>
                <Field label="Ship To Name">
                  <TextInput value={d.ship_to_name} onChange={(e) => setDestinations((prev) => prev.map((x) => (x.key === d.key ? { ...x, ship_to_name: e.target.value } : x)))} />
                </Field>
                <Field label="Ship To Location">
                  <TextInput value={d.ship_to_location} onChange={(e) => setDestinations((prev) => prev.map((x) => (x.key === d.key ? { ...x, ship_to_location: e.target.value } : x)))} />
                </Field>
                <Field label="Ship To Street">
                  <TextInput value={d.ship_to_street} onChange={(e) => setDestinations((prev) => prev.map((x) => (x.key === d.key ? { ...x, ship_to_street: e.target.value } : x)))} />
                </Field>
                <Field label="Kota">
                  <TextInput value={d.kota} onChange={(e) => setDestinations((prev) => prev.map((x) => (x.key === d.key ? { ...x, kota: e.target.value } : x)))} />
                </Field>
                <Field label="Notes" className="md:col-span-2">
                  <TextInput value={d.notes} onChange={(e) => setDestinations((prev) => prev.map((x) => (x.key === d.key ? { ...x, notes: e.target.value } : x)))} />
                </Field>
              </Grid>
            </div>
          ))}
        </div>

        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-brand-700">Items</div>
            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, newItem()])}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-xs font-semibold hover:bg-brand-100"
            >
              <Plus className="w-3.5 h-3.5" /> Tambah Item
            </button>
          </div>
          {items.map((it) => (
            <DraftItemRow
              key={it.key}
              item={it}
              onChange={(next) => setItems((prev) => prev.map((x) => (x.key === it.key ? next : x)))}
              onRemove={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
            />
          ))}
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
            {saving ? 'Menyimpan…' : 'Simpan Order'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function OutboundList() {
  const { canWrite } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<OutboundRow[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [odInput, setOdInput] = useState('');
  const [odNo, setOdNo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [modalOpen, setModalOpen] = useState(false);

  const fetchList = async (p = page, st = status, od = odNo) => {
    setLoading(true);
    try {
      const res = await api('outbound', 'list', { params: { status: st, od_no: od, page: p, per_page: PER_PAGE } });
      setRows(res.rows || []);
      setTotal(res.total);
      if (res.statuses) setStatuses(res.statuses);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, odNo]);

  useEffect(() => {
    api('outbound', 'stats')
      .then((res) => setStats(res.stats || {}))
      .catch(() => {});
  }, []);

  const totalPages = Math.max(1, Math.ceil((total ?? 0) / PER_PAGE));
  const kpiItems = KPI_ORDER.map((k) => ({ key: k, label: KPI_LABELS[k], value: stats[k] })).filter((x) => typeof x.value === 'number');

  return (
    <div>
      <PageHeader
        title="Outbound"
        subtitle="Manage outgoing orders & shipments"
        actions={
          canWrite && (
            <>
              <WebBtn
                href={apiHref('export', 'outbound')}
                label="Export Excel"
                tone="dark"
                icon={<FileSpreadsheet className="w-4 h-4" />}
              />
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold shadow hover:bg-brand-50"
              >
                <Plus className="w-4 h-4" /> New Outbound
              </button>
            </>
          )
        }
      />

      {kpiItems.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 mb-5">
          {kpiItems.map((k) => (
            <div key={k.key} className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
              <div className="text-2xl font-extrabold text-brand-700">{fmtNum(k.value, 0)}</div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-40">
            <option value="">All Status</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <TextInput
            value={odInput}
            onChange={(e) => setOdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setOdNo(odInput.trim());
                setPage(1);
              }
            }}
            placeholder="Cari OD No…"
            className="!w-56"
          />
          <button
            onClick={() => {
              setOdNo(odInput.trim());
              setPage(1);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <Spinner label="Memuat data…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Belum ada outbound order" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-50 text-left text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 font-bold">Order No</th>
                  <th className="px-3 py-2.5 font-bold">Display No</th>
                  <th className="px-3 py-2.5 font-bold">Order Date</th>
                  <th className="px-3 py-2.5 font-bold">Customer</th>
                  <th className="px-3 py-2.5 font-bold">SO No</th>
                  <th className="px-3 py-2.5 font-bold">DO No</th>
                  <th className="px-3 py-2.5 font-bold">Shipment No</th>
                  <th className="px-3 py-2.5 font-bold">Destination</th>
                  <th className="px-3 py-2.5 font-bold text-right">Items</th>
                  <th className="px-3 py-2.5 font-bold text-right">Qty</th>
                  <th className="px-3 py-2.5 font-bold text-right">Pallet</th>
                  <th className="px-3 py-2.5 font-bold">Status</th>
                  <th className="px-3 py-2.5 font-bold">Created By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="table-row border-b border-gray-100">
                    <td className="px-3 py-2.5">
                      <Link to={`/outbound/${r.id}`} className="text-brand-600 font-semibold hover:underline">
                        {r.order_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{r.display_order_no || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(r.order_date)}</td>
                    <td className="px-3 py-2.5 text-gray-800 font-medium">{r.customer_name || r.join?.customer_name || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.so_number || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.do_number || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.shipment_number || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{[r.destination, r.kota].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 text-right">{fmtNum(r.total_items, 0)}</td>
                    <td className="px-3 py-2.5 text-gray-600 text-right">{fmtNum(r.total_qty, 0)}</td>
                    <td className="px-3 py-2.5 text-gray-600 text-right">{fmtNum(r.total_pallet, 0)}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2.5 text-gray-500">{r.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4">
          <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
        </div>
      </Card>

      <NewOutboundModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(id) => {
          setModalOpen(false);
          navigate(`/outbound/${id}`);
        }}
      />
    </div>
  );
}
