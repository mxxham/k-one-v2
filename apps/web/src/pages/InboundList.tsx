import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, RefreshCw, Eye, Trash2, FileSpreadsheet } from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { fmtDate, fmtNum, todayISO } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import Spinner from '@/components/Spinner';
import { Field, TextInput, Select, TextArea, Grid } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';

const PER_PAGE = 50;
const INBOUND_STATUSES = ['Draft', 'Dues In', 'Receiving', 'Good Received', 'Goods Received', 'Unserviceable', 'Picked', 'ATP', 'Completed', 'Cancelled'];

interface InboundRow {
  id: number;
  order_number: string;
  order_date: string;
  carrier_name?: string;
  po_number?: string;
  shipment_no?: string;
  do_number?: string;
  container_no?: string;
  armada_no?: string;
  production_date?: string;
  expected_date?: string;
  status: string;
  notes?: string;
  received_by_name?: string;
  created_by_name?: string;
  total_items: number;
  total_qty: number;
  total_pallet: number;
  od_numbers?: string;
}

interface SearchProduct {
  id: number;
  product_code: string;
  product_name: string;
  uom: string;
  uom_per_pallet: number;
  liters_per_unit?: number;
  stock_qty: number;
}

interface ItemDraft {
  uid: number;
  product_id: number | null;
  product_code: string;
  product_name: string;
  uom: string;
  batch_number: string;
  od_number: string;
  so_number: string;
  quantity: string;
  manufacture_date: string;
  exp_date: string;
  in_process_status: string;
}

interface CreateForm {
  order_date: string;
  carrier_name: string;
  po_number: string;
  shipment_no: string;
  do_number: string;
  container_no: string;
  armada_no: string;
  production_date: string;
  expected_date: string;
  received_by: string;
  status: string;
  notes: string;
}

function KpiCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-2xl font-extrabold text-brand-700 mt-1">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function ProductSearch({
  selected,
  onSelect,
  onClear,
  autoFocus,
}: {
  selected: { id: number; code: string; name: string } | null;
  onSelect: (p: SearchProduct) => void;
  onClear: () => void;
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
        const res = await api('inbound', 'search_products', { params: { q } });
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
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <TextInput
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search product..."
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
export default function InboundList() {
  const navigate = useNavigate();
  const toast = useToast();
  const { canWrite } = useAuth();
  const [searchParams] = useSearchParams();
  const asnIdParam = searchParams.get('asn_id');

  const [rows, setRows] = useState<InboundRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [asnLink, setAsnLink] = useState<{ id: number; asn_number: string; supplier_name?: string; status: string } | null>(null);
  const [asnReady, setAsnReady] = useState(false);

  const [filters, setFilters] = useState({ status: '', od_no: '' });
  const [qOdNo, setQOdNo] = useState('');

  const [stats, setStats] = useState({ this_month: 0, dues_in: 0, receiving: 0, completed: 0 });

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreateForm>({
    order_date: todayISO(),
    carrier_name: '',
    po_number: '',
    shipment_no: '',
    do_number: '',
    container_no: '',
    armada_no: '',
    production_date: '',
    expected_date: '',
    received_by: '',
    status: 'Draft',
    notes: '',
  });
  const [items, setItems] = useState<ItemDraft[]>([]);
  const uidRef = useRef(1);

  const newItem = (): ItemDraft => ({
    uid: uidRef.current++,
    product_id: null,
    product_code: '',
    product_name: '',
    uom: '',
    batch_number: '',
    od_number: '',
    so_number: '',
    quantity: '',
    manufacture_date: '',
    exp_date: '',
    in_process_status: 'Dues In',
  });

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('inbound', 'list', {
        params: { status: filters.status, od_no: filters.od_no, page, per_page: PER_PAGE },
      });
      setRows(res.rows || []);
      setTotal(res.total || 0);
      if (res.statuses) setStatuses(res.statuses);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat data inbound');
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.od_no, page, toast]);

  const loadStats = useCallback(async () => {
    try {
      const res = await api('inbound', 'stats');
      const s = res.stats || {};
      const byStatus: Array<{ status: string; count: number }> = Array.isArray(s.by_status) ? s.by_status : [];
      const completed = byStatus.find((b) => b.status === 'Completed')?.count ?? 0;
      setStats({
        this_month: s.this_month ?? 0,
        dues_in: s.dues_in ?? 0,
        receiving: s.receiving ?? 0,
        completed,
      });
    } catch {
      // stats are non-critical
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (!asnIdParam) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api('asn', 'detail', { params: { id: asnIdParam } });
        const asn = res.asn;
        if (cancelled || !asn) return;
        if (asn.status !== 'Pending') {
          toast('error', 'Hanya ASN berstatus Pending yang dapat dijadikan inbound.');
          return;
        }
        setAsnLink({ id: Number(asn.id), asn_number: asn.asn_number, supplier_name: asn.supplier_name, status: asn.status });
        const asnItems = (asn.items || []).map((ai: any) => ({
          uid: uidRef.current++,
          product_id: Number(ai.product_id),
          product_code: ai.product_code || '',
          product_name: ai.product_name || '',
          uom: ai.uom || '',
          batch_number: ai.batch_number || '',
          od_number: '',
          so_number: '',
          quantity: String(Number(ai.expected_qty || 0)),
          manufacture_date: '',
          exp_date: ai.exp_date || '',
          in_process_status: 'Dues In',
        }));
        setForm((f) => ({
          ...f,
          carrier_name: asn.supplier_name || f.carrier_name,
          expected_date: asn.expected_arrival_date || f.expected_date,
          notes: asn.notes || f.notes,
        }));
        setItems(asnItems.length ? asnItems : [newItem()]);
        setCreateOpen(true);
      } catch (e: any) {
        toast('error', e.message || 'Gagal memuat ASN');
      } finally {
        if (!cancelled) setAsnReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asnIdParam]);

  const applyStatus = (v: string) => {
    setFilters((f) => ({ ...f, status: v }));
    setPage(1);
  };

  const applyOdNo = () => {
    setFilters((f) => ({ ...f, od_no: qOdNo }));
    setPage(1);
  };

  const reload = () => {
    loadList();
    loadStats();
  };

  const openCreate = () => {
    setForm({
      order_date: todayISO(),
      carrier_name: '',
      po_number: '',
      shipment_no: '',
      do_number: '',
      container_no: '',
      armada_no: '',
      production_date: '',
      expected_date: '',
      received_by: '',
      status: 'Draft',
      notes: '',
    });
    setItems([newItem()]);
    setCreateOpen(true);
  };

  const updateItem = (uid: number, patch: Partial<ItemDraft>) =>
    setItems((arr) => arr.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));

  const removeItem = (uid: number) => setItems((arr) => arr.filter((it) => it.uid !== uid));

  const handleCreate = async () => {
    if (!form.order_date) {
      toast('error', 'Order date wajib diisi');
      return;
    }
    const validItems = items.filter((i) => i.product_id && Number(i.quantity) > 0);
    if (!validItems.length) {
      toast('error', 'Tambahkan minimal 1 item dengan produk dan quantity');
      return;
    }
    setSaving(true);
    try {
      const res = await api('inbound', 'create', {
        body: {
          order_date: form.order_date,
          carrier_name: form.carrier_name || undefined,
          po_number: form.po_number || undefined,
          shipment_no: form.shipment_no || undefined,
          do_number: form.do_number || undefined,
          container_no: form.container_no || undefined,
          armada_no: form.armada_no || undefined,
          production_date: form.production_date || undefined,
          expected_date: form.expected_date || undefined,
          received_by: form.received_by || undefined,
          status: form.status || 'Draft',
notes: form.notes || undefined,
          asn_id: asnLink?.id || undefined,
          items: validItems.map((i) => ({
            product_id: i.product_id!,
            batch_number: i.batch_number || undefined,
            od_number: i.od_number || undefined,
            so_number: i.so_number || undefined,
            quantity: Number(i.quantity),
            uom: i.uom || undefined,
            actual_qty: Number(i.quantity),
            manufacture_date: i.manufacture_date || undefined,
            exp_date: i.exp_date || undefined,
            in_process_status: i.in_process_status,
          })),
        },
      });
      toast('success', `Inbound ${res.order_number || ''} berhasil dibuat`);
      setCreateOpen(false);
      navigate(`/inbound/${res.id}`);
    } catch (e: any) {
      toast('error', e.message || 'Gagal membuat inbound');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  return (
    <div>
      <PageHeader
        title="Inbound Orders"
        subtitle="Manage incoming stock deliveries"
actions={
          canWrite ? (
            <>
              <WebBtn
                href={apiHref('export', 'inbound')}
                label="Export Excel"
                tone="dark"
                icon={<FileSpreadsheet className="w-4 h-4" />}
              />
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 shadow"
              >
                <Plus className="w-4 h-4" /> New Inbound
              </button>
            </>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KpiCard label="This Month" value={fmtNum(stats.this_month, 0)} />
        <KpiCard label="Dues In" value={fmtNum(stats.dues_in, 0)} />
        <KpiCard label="Receiving" value={fmtNum(stats.receiving, 0)} />
        <KpiCard label="Completed" value={fmtNum(stats.completed, 0)} />
      </div>

      <Card>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <Select value={filters.status} onChange={(e) => applyStatus(e.target.value)} className="w-44">
            <option value="">All Status</option>
            {(statuses.length ? statuses : INBOUND_STATUSES).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <TextInput
              value={qOdNo}
              onChange={(e) => setQOdNo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyOdNo()}
              placeholder="OD No..."
              className="pl-9 w-48"
            />
          </div>
          <button
            onClick={applyOdNo}
            className="px-3 py-2 rounded-lg bg-brand-50 text-brand-700 border border-brand-200 text-sm font-semibold hover:bg-brand-100"
          >
            Search
          </button>
          <button
            onClick={reload}
            title="Refresh"
            className="p-2 rounded-lg bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <Spinner label="Loading inbound..." />
        ) : rows.length === 0 ? (
          <EmptyState message="Belum ada inbound yang cocok" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Order No</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Order Date</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Shipment</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">DO</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Carrier</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">OD Nos</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Items</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Qty</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Pallet</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Status</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Created By</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-brand-50 transition-colors">
                      <td className="px-3 py-2.5">
                        <Link to={`/inbound/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                          {r.order_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{fmtDate(r.order_date)}</td>
                      <td className="px-3 py-2.5 text-gray-600">{r.shipment_no || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{r.do_number || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{r.carrier_name || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">
                        <span title={r.od_numbers} className="block max-w-[160px] truncate">
                          {r.od_numbers || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium text-right">{fmtNum(r.total_items, 0)}</td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium text-right">{fmtNum(r.total_qty, 0)}</td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium text-right">{fmtNum(r.total_pallet, 0)}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{r.created_by_name || '—'}</td>
                      <td className="px-3 py-2.5">
                        <Link
                          to={`/inbound/${r.id}`}
                          title="View"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
            </div>
          </>
        )}
      </Card>

<Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Inbound" size="xl">
        <div className="space-y-4">
          {asnLink && (
            <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
              <div className="w-1.5 h-10 rounded-full bg-brand-500" />
              <div className="text-sm">
                <div className="font-bold text-brand-800">Dibuat dari ASN <Link to={`/asn/${asnLink.id}`} className="underline">{asnLink.asn_number}</Link></div>
                <div className="text-xs text-brand-700/80">
                  Supplier: {asnLink.supplier_name || '—'} · Items sudah terisi sesuai ASN. Quantity menyesuaikan yang diterima.
                </div>
              </div>
            </div>
          )}
          <Grid cols={3}>
            <Field label="Order Date" required>
              <TextInput type="date" value={form.order_date} onChange={(e) => setForm((f) => ({ ...f, order_date: e.target.value }))} />
            </Field>
            <Field label="Carrier Name">
              <TextInput value={form.carrier_name} onChange={(e) => setForm((f) => ({ ...f, carrier_name: e.target.value }))} />
            </Field>
            <Field label="PO Number">
              <TextInput value={form.po_number} onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))} />
            </Field>
          </Grid>
          <Grid cols={3}>
            <Field label="Shipment No">
              <TextInput value={form.shipment_no} onChange={(e) => setForm((f) => ({ ...f, shipment_no: e.target.value }))} />
            </Field>
            <Field label="DO Number">
              <TextInput value={form.do_number} onChange={(e) => setForm((f) => ({ ...f, do_number: e.target.value }))} />
            </Field>
            <Field label="Container No">
              <TextInput value={form.container_no} onChange={(e) => setForm((f) => ({ ...f, container_no: e.target.value }))} />
            </Field>
          </Grid>
          <Grid cols={3}>
            <Field label="Armada No">
              <TextInput value={form.armada_no} onChange={(e) => setForm((f) => ({ ...f, armada_no: e.target.value }))} />
            </Field>
            <Field label="Production Date">
              <TextInput type="date" value={form.production_date} onChange={(e) => setForm((f) => ({ ...f, production_date: e.target.value }))} />
            </Field>
            <Field label="Expected Date">
              <TextInput type="date" value={form.expected_date} onChange={(e) => setForm((f) => ({ ...f, expected_date: e.target.value }))} />
            </Field>
          </Grid>
          <Grid cols={3}>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {INBOUND_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Received By">
              <TextInput value={form.received_by} onChange={(e) => setForm((f) => ({ ...f, received_by: e.target.value }))} />
            </Field>
            <Field label="Notes">
              <TextInput value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </Grid>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-gray-700">Items</h4>
              <button
                type="button"
                onClick={() => setItems((a) => [...a, newItem()])}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100"
              >
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>
            <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
              {items.map((item, idx) => (
                <div key={item.uid} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-500">Item #{idx + 1}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.uid)}
                        className="text-xs text-red-500 hover:text-red-700 font-semibold flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    )}
                  </div>
                  <Field label="Product" required>
                    <ProductSearch
                      selected={item.product_id ? { id: item.product_id, code: item.product_code, name: item.product_name } : null}
                      onSelect={(p) =>
                        updateItem(item.uid, { product_id: p.id, product_code: p.product_code, product_name: p.product_name, uom: p.uom || '' })
                      }
                      onClear={() => updateItem(item.uid, { product_id: null, product_code: '', product_name: '', uom: '' })}
                    />
                  </Field>
                  <Grid cols={3}>
                    <Field label="Batch Number">
                      <TextInput value={item.batch_number} onChange={(e) => updateItem(item.uid, { batch_number: e.target.value })} />
                    </Field>
                    <Field label="OD Number">
                      <TextInput value={item.od_number} onChange={(e) => updateItem(item.uid, { od_number: e.target.value })} />
                    </Field>
                    <Field label="SO Number">
                      <TextInput value={item.so_number} onChange={(e) => updateItem(item.uid, { so_number: e.target.value })} />
                    </Field>
                  </Grid>
                  <Grid cols={3}>
                    <Field label="Quantity" required>
                      <TextInput
                        type="number"
                        min={0}
                        value={item.quantity}
                        onChange={(e) => updateItem(item.uid, { quantity: e.target.value })}
                      />
                    </Field>
                    <Field label="UOM">
                      <TextInput value={item.uom} onChange={(e) => updateItem(item.uid, { uom: e.target.value })} />
                    </Field>
                    <Field label="In Process Status">
                      <Select value={item.in_process_status} onChange={(e) => updateItem(item.uid, { in_process_status: e.target.value })}>
                        {['Dues In', 'Goods Received', 'Unserviceable', 'ATP'].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </Field>
                  </Grid>
                  <Grid cols={2}>
                    <Field label="Manufacture Date">
                      <TextInput type="date" value={item.manufacture_date} onChange={(e) => updateItem(item.uid, { manufacture_date: e.target.value })} />
                    </Field>
                    <Field label="Expiry Date">
                      <TextInput type="date" value={item.exp_date} onChange={(e) => updateItem(item.uid, { exp_date: e.target.value })} />
                    </Field>
                  </Grid>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold"
            >
              Batal
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-semibold disabled:opacity-60"
            >
              {saving ? 'Menyimpan...' : 'Create Inbound'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
