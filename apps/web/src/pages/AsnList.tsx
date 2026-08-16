import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, RefreshCw, Eye, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
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
const ASN_STATUSES = ['Pending', 'Received', 'Cancelled'];

interface AsnRow {
  id: number;
  asn_number: string;
  supplier_name?: string;
  supplier_reference?: string;
  expected_arrival_date?: string;
  status: string;
  notes?: string;
  created_by_name?: string;
  total_items: number;
  expected_qty: number;
}

interface SearchProduct {
  id: number;
  product_code: string;
  product_name: string;
  uom: string;
  uom_per_pallet: number;
}

interface AsnItemDraft {
  uid: number;
  product_id: number | null;
  product_code: string;
  product_name: string;
  uom: string;
  batch_number: string;
  expected_qty: string;
  exp_date: string;
}

interface AsnForm {
  supplier_name: string;
  supplier_reference: string;
  expected_arrival_date: string;
  notes: string;
}

function ProductSearch({
  selected,
  onSelect,
  onClear,
}: {
  selected: { id: number; code: string; name: string } | null;
  onSelect: (p: SearchProduct) => void;
  onClear: () => void;
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AsnList() {
  const navigate = useNavigate();
  const toast = useToast();
  const { canWrite } = useAuth();

  const [rows, setRows] = useState<AsnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AsnForm>({
    supplier_name: '',
    supplier_reference: '',
    expected_arrival_date: '',
    notes: '',
  });
  const [items, setItems] = useState<AsnItemDraft[]>([]);
  const uidRef = useRef(1);

  const newItem = (): AsnItemDraft => ({
    uid: uidRef.current++,
    product_id: null,
    product_code: '',
    product_name: '',
    uom: '',
    batch_number: '',
    expected_qty: '',
    exp_date: '',
  });

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('asn', 'list', {
        params: { status, page, per_page: PER_PAGE },
      });
      setRows(res.rows || []);
      setTotal(res.total || 0);
      if (res.statuses) setStatuses(res.statuses);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat data ASN');
    } finally {
      setLoading(false);
    }
  }, [status, page, toast]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openCreate = () => {
    setForm({ supplier_name: '', supplier_reference: '', expected_arrival_date: '', notes: '' });
    setItems([newItem()]);
    setCreateOpen(true);
  };

  const updateItem = (uid: number, patch: Partial<AsnItemDraft>) =>
    setItems((arr) => arr.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));

  const removeItem = (uid: number) => setItems((arr) => arr.filter((it) => it.uid !== uid));

  const handleCreate = async () => {
    if (!form.supplier_name) {
      toast('error', 'Supplier name wajib diisi');
      return;
    }
    const validItems = items.filter((i) => i.product_id && Number(i.expected_qty) > 0);
    if (!validItems.length) {
      toast('error', 'Tambahkan minimal 1 item dengan produk dan expected quantity');
      return;
    }
    setSaving(true);
    try {
      const res = await api('asn', 'create', {
        body: {
          supplier_name: form.supplier_name,
          supplier_reference: form.supplier_reference || undefined,
          expected_arrival_date: form.expected_arrival_date || undefined,
          notes: form.notes || undefined,
          items: validItems.map((i) => ({
            product_id: i.product_id!,
            uom: i.uom || undefined,
            batch_number: i.batch_number || undefined,
            expected_qty: Number(i.expected_qty),
            exp_date: i.exp_date || undefined,
          })),
        },
      });
      toast('success', `ASN ${res.asn_number || ''} berhasil dibuat`);
      setCreateOpen(false);
      navigate(`/asn/${res.id}`);
    } catch (e: any) {
      toast('error', e.message || 'Gagal membuat ASN');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  return (
    <div>
      <PageHeader
        title="Advance Shipping Notices"
        subtitle="Expected inbound shipments notified by suppliers before arrival"
        actions={
          canWrite ? (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 shadow"
            >
              <Plus className="w-4 h-4" /> New ASN
            </button>
          ) : undefined
        }
      />

      <Card>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44">
            <option value="">All Status</option>
            {(statuses.length ? statuses : ASN_STATUSES).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <button onClick={loadList} title="Refresh" className="p-2 rounded-lg bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <Spinner label="Loading ASN..." />
        ) : rows.length === 0 ? (
          <EmptyState message="Belum ada ASN yang cocok" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">ASN No</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Supplier</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Supplier Ref</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Expected Arrival</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Items</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Expected Qty</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Status</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Created By</th>
                    <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-brand-50 transition-colors">
                      <td className="px-3 py-2.5">
                        <Link to={`/asn/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                          {r.asn_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{r.supplier_name || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{r.supplier_reference || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{fmtDate(r.expected_arrival_date)}</td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium text-right">{fmtNum(r.total_items, 0)}</td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium text-right">{fmtNum(r.expected_qty, 0)}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{r.created_by_name || '—'}</td>
                      <td className="px-3 py-2.5">
                        <Link
                          to={`/asn/${r.id}`}
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

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New ASN" size="xl">
        <div className="space-y-4">
          <Grid cols={3}>
            <Field label="Supplier Name" required>
              <TextInput value={form.supplier_name} onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))} />
            </Field>
            <Field label="Supplier Reference">
              <TextInput value={form.supplier_reference} onChange={(e) => setForm((f) => ({ ...f, supplier_reference: e.target.value }))} />
            </Field>
            <Field label="Expected Arrival Date">
              <TextInput type="date" value={form.expected_arrival_date} onChange={(e) => setForm((f) => ({ ...f, expected_arrival_date: e.target.value }))} />
            </Field>
          </Grid>
          <Field label="Notes">
            <TextArea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-gray-700">Expected Items</h4>
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
                  <Grid cols={4}>
                    <Field label="Expected Qty" required>
                      <TextInput
                        type="number"
                        min={0}
                        value={item.expected_qty}
                        onChange={(e) => updateItem(item.uid, { expected_qty: e.target.value })}
                      />
                    </Field>
                    <Field label="UOM">
                      <TextInput value={item.uom} onChange={(e) => updateItem(item.uid, { uom: e.target.value })} />
                    </Field>
                    <Field label="Batch / Lot">
                      <TextInput value={item.batch_number} onChange={(e) => updateItem(item.uid, { batch_number: e.target.value })} />
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
              {saving ? 'Menyimpan...' : 'Create ASN'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}