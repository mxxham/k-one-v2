import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Search, Plus, RefreshCw, Pencil, Box, Package, Layers, FileSpreadsheet, Gauge } from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { fmtNum } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import Spinner from '@/components/Spinner';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, Select, TextArea, Grid } from '@/components/Field';
import StatusBadge from '@/components/StatusBadge';

interface Product {
  id: number;
  product_code: string;
  product_name: string;
  category: string | null;
  description: string | null;
  drums_per_pallet: number;
  uom_type: string;
  uom_per_pallet: number;
  liters_per_unit: number;
  max_sku_qty: number;
  max_trans_qty: number;
  is_active: number;
  total_qty: number;
  total_drums: number;
  total_pallets: number;
  velocity_class: string | null;
}

interface AbcRow {
  product_id: number;
  product_code: string | null;
  product_name: string | null;
  picked_qty: number;
  cumulative_qty: number;
  cumulative_share: number;
  velocity_class: 'A' | 'B' | 'C' | null;
}

interface AbcResult {
  rows: AbcRow[];
  total_qty: number;
  counts: { A: number; B: number; C: number; unclassified: number };
  split: { a: number; b: number; c: number };
  date_from: string;
  date_to: string;
}

const PER_PAGE = 25;
const UOM_OPTIONS = ['Drum', 'Carton', 'Pail', 'EA', 'Bags'];

const emptyForm = {
  product_code: '',
  product_name: '',
  category: '',
  description: '',
  drums_per_pallet: '4',
  uom_type: 'Drum',
  uom_per_pallet: '4',
  liters_per_unit: '209',
  max_sku_qty: '44',
  max_trans_qty: '80',
};

export default function ProductsPage() {
  const toast = useToast();
  const { canWrite, canAdmin } = useAuth();

  const [rows, setRows] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAll, setTotalAll] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [uomStats, setUomStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [abcOpen, setAbcOpen] = useState(false);
  const [abcLoading, setAbcLoading] = useState(false);
  const [abcRecomputing, setAbcRecomputing] = useState(false);
  const [abc, setAbc] = useState<AbcResult | null>(null);
  const [abcFrom, setAbcFrom] = useState('');
  const [abcTo, setAbcTo] = useState('');
  const [abcA, setAbcA] = useState('80');
  const [abcB, setAbcB] = useState('15');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('products', 'list', { params: { search, page, per_page: PER_PAGE } });
      setRows(res.rows || []);
      setTotal(Number(res.total) || 0);
      setTotalAll(Number(res.total_all) || 0);
      setUomStats(res.uom_stats || {});
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data produk');
    } finally {
      setLoading(false);
    }
  }, [search, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      product_code: p.product_code || '',
      product_name: p.product_name || '',
      category: p.category || '',
      description: p.description || '',
      drums_per_pallet: String(p.drums_per_pallet ?? 4),
      uom_type: p.uom_type || 'Drum',
      uom_per_pallet: String(p.uom_per_pallet ?? 4),
      liters_per_unit: String(p.liters_per_unit ?? 209),
      max_sku_qty: String(p.max_sku_qty ?? 44),
      max_trans_qty: String(p.max_trans_qty ?? 80),
    });
    setModalOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.product_code.trim() || !form.product_name.trim()) {
      toast('error', 'Kode dan nama produk wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        drums_per_pallet: Number(form.drums_per_pallet) || 4,
        uom_per_pallet: Number(form.uom_per_pallet) || 4,
        liters_per_unit: Number(form.liters_per_unit) || 0,
        max_sku_qty: Number(form.max_sku_qty) || 0,
        max_trans_qty: Number(form.max_trans_qty) || 0,
        category: form.category || undefined,
        description: form.description || undefined,
      };
      if (editing) {
        await api('products', 'update', { body: { id: editing.id, ...payload } });
        toast('success', 'Produk berhasil diperbarui');
      } else {
        await api('products', 'create', { body: payload });
        toast('success', 'Produk berhasil ditambahkan');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan produk');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Product) => {
    try {
      await api('products', 'delete', { body: { id: p.id } });
      toast('success', 'Produk dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus produk');
    }
  };

  const set = (k: keyof typeof emptyForm) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const abcParams = () => {
    const p: Record<string, string> = {};
    if (abcFrom) p.date_from = abcFrom;
    if (abcTo) p.date_to = abcTo;
    if (abcA) p.split_a = abcA;
    if (abcB) p.split_b = abcB;
    return p;
  };

  const runAbcAnalyze = async () => {
    setAbcLoading(true);
    try {
      const res = await api('abc', 'analyze', { params: abcParams() });
      setAbc(res as unknown as AbcResult);
    } catch (err: any) {
      toast('error', err.message || 'Gagal menjalankan analisis ABC');
    } finally {
      setAbcLoading(false);
    }
  };

  const runAbcRecompute = async () => {
    setAbcRecomputing(true);
    try {
      const res = await api('abc', 'recompute', { params: abcParams() });
      setAbc(res as unknown as AbcResult);
      toast('success', 'Klasifikasi velocity_class berhasil diperbarui');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal recompute ABC');
    } finally {
      setAbcRecomputing(false);
    }
  };

  const openAbc = () => {
    setAbc(null);
    setAbcOpen(true);
    runAbcAnalyze();
  };

  const uomCards = Object.entries(uomStats).map(([uom, count]) => ({
    label: uom || '—',
    value: count,
  }));

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Master data produk"
        actions={
          <>
            <WebBtn
              href={apiHref('export', 'products')}
              label="Export Excel"
              tone="dark"
              icon={<FileSpreadsheet className="w-4 h-4" />}
            />
            {canWrite && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
              >
                <Plus className="w-4 h-4" /> New Product
              </button>
            )}
            <button
              onClick={() => { setPage(1); load(); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            {canAdmin && (
              <button
                onClick={openAbc}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
              >
                <Gauge className="w-4 h-4" /> ABC Analysis
              </button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
            <Box className="w-4 h-4" />
          </span>
          <div>
            <div className="text-lg font-bold text-brand-900">{fmtNum(totalAll, 0)}</div>
            <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">Total Produk</div>
          </div>
        </div>
        {uomCards.map((u) => (
          <div key={u.label} className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3 flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </span>
            <div>
              <div className="text-lg font-bold text-brand-900">{fmtNum(u.value, 0)}</div>
              <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{u.label}</div>
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div className="mb-4">
          <form onSubmit={handleSearch} className="flex items-end gap-3 flex-wrap">
            <div className="w-full md:w-80">
              <Field label="Cari Produk">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <TextInput
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Kode, nama, atau kategori…"
                    className="pl-9"
                  />
                </div>
              </Field>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 inline-flex items-center gap-2"
            >
              <Search className="w-4 h-4" /> Cari
            </button>
          </form>
        </div>

        {loading ? (
          <Spinner label="Memuat produk…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Tidak ada data produk" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                    <th className="px-3 py-2.5 text-left font-bold">Kode</th>
                    <th className="px-3 py-2.5 text-left font-bold">Nama Produk</th>
                    <th className="px-3 py-2.5 text-left font-bold">Kategori</th>
                    <th className="px-3 py-2.5 text-center font-bold">UOM</th>
                    <th className="px-3 py-2.5 text-right font-bold">UOM/Pallet</th>
                    <th className="px-3 py-2.5 text-right font-bold">Ltr/Unit</th>
                    <th className="px-3 py-2.5 text-right font-bold">Max SKU</th>
                    <th className="px-3 py-2.5 text-right font-bold">Max Trans</th>
                    <th className="px-3 py-2.5 text-right font-bold">Total Qty</th>
                    <th className="px-3 py-2.5 text-right font-bold">Pallet</th>
                    <th className="px-3 py-2.5 text-center font-bold">Velocity</th>
                    <th className="px-3 py-2.5 text-center font-bold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((p) => (
                    <tr key={p.id} className="hover:bg-brand-50/50">
                      <td className="px-3 py-2.5 font-semibold text-brand-700">{p.product_code}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-gray-800">{p.product_name}</div>
                        {p.description && <div className="text-xs text-gray-400 max-w-[220px] truncate">{p.description}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{p.category || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-gray-600">{p.uom_type || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{fmtNum(p.uom_per_pallet)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{fmtNum(p.liters_per_unit)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{fmtNum(p.max_sku_qty, 0)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{fmtNum(p.max_trans_qty, 0)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">{fmtNum(p.total_qty ?? p.total_drums, 0)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-brand-600">{fmtNum(p.total_pallets, 0)}</td>
                      <td className="px-3 py-2.5 text-center">
                        {p.velocity_class ? (
                          <StatusBadge status={p.velocity_class} />
                        ) : (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          {canWrite && (
                            <button
                              onClick={() => openEdit(p)}
                              title="Edit"
                              className="p-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 border border-brand-100"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canAdmin && (
                            <ConfirmButton label="Hapus" onConfirm={() => handleDelete(p)} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 mt-4 border-t border-gray-100 pt-4 flex-wrap">
              <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
            </div>
          </>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Product' : 'New Product'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <Grid cols={2}>
            <Field label="Kode Produk" required>
              <TextInput value={form.product_code} onChange={set('product_code')} placeholder="Contoh: PO-001" />
            </Field>
            <Field label="Nama Produk" required>
              <TextInput value={form.product_name} onChange={set('product_name')} placeholder="Nama produk" />
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Kategori">
              <TextInput value={form.category} onChange={set('category')} placeholder="Kategori produk" />
            </Field>
            <Field label="UOM Type">
              <Select value={form.uom_type} onChange={set('uom_type')}>
                {UOM_OPTIONS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            </Field>
          </Grid>
          <Grid cols={4}>
            <Field label="Drums/Pallet">
              <TextInput type="number" min="1" value={form.drums_per_pallet} onChange={set('drums_per_pallet')} />
            </Field>
            <Field label="UOM/Pallet">
              <TextInput type="number" min="1" value={form.uom_per_pallet} onChange={set('uom_per_pallet')} />
            </Field>
            <Field label="Liter/Unit">
              <TextInput type="number" step="0.01" value={form.liters_per_unit} onChange={set('liters_per_unit')} />
            </Field>
            <Field label="Max SKU Qty">
              <TextInput type="number" min="0" value={form.max_sku_qty} onChange={set('max_sku_qty')} />
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Max Trans Qty">
              <TextInput type="number" min="0" value={form.max_trans_qty} onChange={set('max_trans_qty')} />
            </Field>
            <Field label="Deskripsi">
              <TextArea rows={2} value={form.description} onChange={set('description')} placeholder="Catatan produk (opsional)" />
            </Field>
          </Grid>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-60"
            >
              <Layers className="w-4 h-4" /> {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Tambah Produk'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={abcOpen} onClose={() => setAbcOpen(false)} title="ABC Analysis / Velocity Ranking" size="xl">
        <div className="space-y-4">
          <div className="flex items-end gap-3 flex-wrap">
            <Field label="Dari Tanggal">
              <TextInput type="date" value={abcFrom} onChange={(e) => setAbcFrom(e.target.value)} />
            </Field>
            <Field label="Sampai Tanggal">
              <TextInput type="date" value={abcTo} onChange={(e) => setAbcTo(e.target.value)} />
            </Field>
            <Field label="Split A %">
              <TextInput type="number" min="0" max="100" value={abcA} onChange={(e) => setAbcA(e.target.value)} className="w-24" />
            </Field>
            <Field label="Split B %">
              <TextInput type="number" min="0" max="100" value={abcB} onChange={(e) => setAbcB(e.target.value)} className="w-24" />
            </Field>
            <button
              onClick={runAbcAnalyze}
              disabled={abcLoading}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
            >
              {abcLoading ? 'Menganalisa…' : 'Analisa'}
            </button>
            {canAdmin && (
              <button
                onClick={runAbcRecompute}
                disabled={abcRecomputing || abcLoading}
                className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-60"
              >
                {abcRecomputing ? 'Menyimpan…' : 'Recompute & Simpan'}
              </button>
            )}
          </div>

          {abc && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-red-50 rounded-xl border border-red-200 px-4 py-3">
                  <div className="text-lg font-extrabold text-red-700">{fmtNum(abc.counts.A, 0)}</div>
                  <div className="text-[11px] text-red-600 font-bold uppercase tracking-wide">A · {abc.split.a}%</div>
                </div>
                <div className="bg-amber-50 rounded-xl border border-amber-200 px-4 py-3">
                  <div className="text-lg font-extrabold text-amber-700">{fmtNum(abc.counts.B, 0)}</div>
                  <div className="text-[11px] text-amber-600 font-bold uppercase tracking-wide">B · {abc.split.b}%</div>
                </div>
                <div className="bg-gray-50 rounded-xl border border-gray-200 px-4 py-3">
                  <div className="text-lg font-extrabold text-gray-700">{fmtNum(abc.counts.C, 0)}</div>
                  <div className="text-[11px] text-gray-500 font-bold uppercase tracking-wide">C · {abc.split.c}%</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                  <div className="text-lg font-extrabold text-gray-700">{fmtNum(abc.counts.unclassified, 0)}</div>
                  <div className="text-[11px] text-gray-400 font-bold uppercase tracking-wide">Unclassified</div>
                </div>
                <div className="bg-brand-50 rounded-xl border border-brand-200 px-4 py-3">
                  <div className="text-lg font-extrabold text-brand-700">{fmtNum(abc.total_qty, 0)}</div>
                  <div className="text-[11px] text-brand-600 font-bold uppercase tracking-wide">Total Picked</div>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-brand-50">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                      <th className="px-3 py-2.5 font-bold">Product</th>
                      <th className="px-3 py-2.5 text-right font-bold">Picked Qty</th>
                      <th className="px-3 py-2.5 text-right font-bold">Cumulative</th>
                      <th className="px-3 py-2.5 text-right font-bold">Cum %</th>
                      <th className="px-3 py-2.5 text-center font-bold">Class</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {abc.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-brand-50/50">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-brand-700">{r.product_code || '—'}</div>
                          <div className="text-xs text-gray-500">{r.product_name}</div>
                        </td>
                        <td className="px-3 py-2 text-right">{fmtNum(r.picked_qty, 0)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(r.cumulative_qty, 0)}</td>
                        <td className="px-3 py-2 text-right">{(r.cumulative_share * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2 text-center">
                          {r.velocity_class ? <StatusBadge status={r.velocity_class} /> : <span className="text-[11px] text-gray-400">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
