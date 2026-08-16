import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search,
  RefreshCw,
  ArrowRightLeft,
  SlidersHorizontal,
  Boxes,
  Layers,
  PackageOpen,
  CalendarClock,
  PackageX,
  Lock,
  Clock,
  FileSpreadsheet,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { Field, TextInput, Select, TextArea } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { fmtNum, fmtDate, expiryInfo } from '@/lib/format';

const STATUS_OPTIONS = ['Available', 'Reserved', 'Expired', 'Dues In', 'Rejected'];

interface StockRow {
  id: number;
  product_id: number;
  product_code: string;
  product_name: string;
  category: string;
  uom_type: string;
  uom_per_pallet: number;
  velocity_class: string | null;
  batch_number: string;
  location: string;
  quantity: number;
  uom: string;
  pallet: number;
  manufacture_date: string;
  expiry_date: string;
  stock_status: string;
  hold_status: string;
  hold_reason: string;
  hold_by: number | null;
  hold_at: string | null;
}

interface StockSummary {
  total_products: number;
  total_drums: number;
  total_pallets: number;
  available_items: number;
  reserved_items: number;
  expired_items: number;
  dues_in_items: number;
  expiring_soon: number;
  critical: number;
  expired: number;
  total_qty: number;
}

interface ByLocationRow {
  area: string;
  products: number;
  total_qty: number;
  total_pallet: number;
}

export default function StockPage() {
  const toast = useToast();
  const { canWrite, canAdmin } = useAuth();
  const [searchParams] = useSearchParams();

  const [rows, setRows] = useState<StockRow[]>([]);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [byLocation, setByLocation] = useState<ByLocationRow[]>([]);
  const [locations, setLocations] = useState<string[]>([]);

  const [q, setQ] = useState(() => searchParams.get('q') || '');
  const [qApplied, setQApplied] = useState(() => searchParams.get('q') || '');
  const [status, setStatus] = useState('');
  const [location, setLocation] = useState('');
  const [year, setYear] = useState(() => searchParams.get('year') || '');
  const [expiring, setExpiring] = useState(false);
  const [loading, setLoading] = useState(true);

  const [transferRow, setTransferRow] = useState<StockRow | null>(null);
  const [toLoc, setToLoc] = useState('');
  const [tQty, setTQty] = useState('');
  const [adjustRow, setAdjustRow] = useState<StockRow | null>(null);
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [holdRow, setHoldRow] = useState<StockRow | null>(null);
  const [holdStatus, setHoldStatus] = useState('on_hold');
  const [holdReason, setHoldReason] = useState('');
  const [releaseRow, setReleaseRow] = useState<StockRow | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('stock', 'list', {
        params: { status, q: qApplied, location, year: year || undefined, expiring: expiring ? '1' : undefined },
      });
      setRows((res.rows || []) as StockRow[]);
      if (res.summary) setSummary(res.summary as StockSummary);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat data stok');
    } finally {
      setLoading(false);
    }
  }, [status, qApplied, location, year, expiring, toast]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadSummary = async () => {
    try {
      const res = await api('stock', 'summary');
      setSummary(res.summary as StockSummary);
    } catch {
      // non-fatal
    }
  };

  const loadByLocation = async () => {
    try {
      const res = await api('stock', 'by_location');
      setByLocation((res.rows || []) as ByLocationRow[]);
    } catch {
      // non-fatal
    }
  };

  useEffect(() => {
    api('stock', 'locations')
      .then((res) => setLocations((res.rows || []) as string[]))
      .catch(() => {});
    loadSummary();
    loadByLocation();
  }, []);

  const reload = () => {
    loadList();
    loadSummary();
    loadByLocation();
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setQApplied(q);
  };

  const openTransfer = (r: StockRow) => {
    setTransferRow(r);
    setToLoc('');
    setTQty('');
  };

  const openAdjust = (r: StockRow) => {
    setAdjustRow(r);
    setAdjQty(String(r.quantity ?? ''));
    setAdjReason('');
  };

  const openHold = (r: StockRow) => {
    setHoldRow(r);
    setHoldStatus('on_hold');
    setHoldReason('');
  };

  const openRelease = (r: StockRow) => {
    setReleaseRow(r);
    setReleaseReason('');
  };

  const submitTransfer = async (e: FormEvent) => {
    e.preventDefault();
    if (!transferRow) return;
    setSubmitting(true);
    try {
      const body: Record<string, any> = { stock_id: transferRow.id, to_location: toLoc.trim() };
      if (tQty !== '') body.quantity = Number(tQty);
      await api('stock', 'transfer', { method: 'POST', body });
      toast('success', 'Transfer stok berhasil');
      setTransferRow(null);
      reload();
    } catch (err: any) {
      toast('error', err.message || 'Transfer stok gagal');
    } finally {
      setSubmitting(false);
    }
  };

  const submitAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!adjustRow) return;
    const qtyNum = Number(adjQty);
    if (adjQty === '' || isNaN(qtyNum)) {
      toast('error', 'Isi jumlah dengan benar');
      return;
    }
    setSubmitting(true);
    try {
      await api('stock', 'adjust', {
        method: 'POST',
        body: { stock_id: adjustRow.id, quantity: qtyNum, reason: adjReason.trim() },
      });
      toast('success', 'Adjustment stok berhasil');
      setAdjustRow(null);
      reload();
    } catch (err: any) {
      toast('error', err.message || 'Adjustment stok gagal');
    } finally {
      setSubmitting(false);
    }
  };

  const submitHold = async (e: FormEvent) => {
    e.preventDefault();
    if (!holdRow) return;
    if (!holdReason.trim()) {
      toast('error', 'Alasan hold wajib diisi');
      return;
    }
    setSubmitting(true);
    try {
      await api('stock', 'hold', {
        method: 'POST',
        body: { stock_id: holdRow.id, status: holdStatus, reason: holdReason.trim() },
      });
      toast('success', 'Stok di-hold');
      setHoldRow(null);
      reload();
    } catch (err: any) {
      toast('error', err.message || 'Hold stok gagal');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRelease = async (e: FormEvent) => {
    e.preventDefault();
    if (!releaseRow) return;
    setSubmitting(true);
    try {
      await api('stock', 'release', {
        method: 'POST',
        body: { stock_id: releaseRow.id, reason: releaseReason.trim() },
      });
      toast('success', 'Stok di-release');
      setReleaseRow(null);
      reload();
    } catch (err: any) {
      toast('error', err.message || 'Release stok gagal');
    } finally {
      setSubmitting(false);
    }
  };

  const expiryCls = (level: string): string => {
    switch (level) {
      case 'expired':
        return 'text-red-600 font-semibold';
      case 'critical':
        return 'text-red-600 font-medium';
      case 'warning':
        return 'text-orange-600 font-medium';
      default:
        return 'text-gray-700';
    }
  };

  return (
    <div>
      <PageHeader
        title="Stock"
        subtitle="Ketersediaan stok, batch, dan lokasi penyimpanan"
        actions={
          <>
            <WebBtn
              href={apiHref('export', 'stock')}
              label="Export Excel"
              tone="dark"
              icon={<FileSpreadsheet className="w-4 h-4" />}
            />
            <button
              onClick={reload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/15 border border-white/30 text-white text-sm font-semibold hover:bg-white/25"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 mb-5">
          {[
            { label: 'Total Produk', value: summary.total_products, icon: <Boxes className="w-4 h-4" />, cls: 'bg-brand-50 text-brand-600' },
            { label: 'Total Drum', value: summary.total_drums, icon: <Layers className="w-4 h-4" />, cls: 'bg-brand-50 text-brand-600' },
            { label: 'Total Pallet', value: summary.total_pallets, icon: <PackageOpen className="w-4 h-4" />, cls: 'bg-brand-50 text-brand-600' },
            { label: 'Segera Expire', value: summary.expiring_soon, icon: <CalendarClock className="w-4 h-4" />, cls: 'bg-orange-50 text-orange-600' },
            { label: 'Expired', value: summary.expired, icon: <PackageX className="w-4 h-4" />, cls: 'bg-red-50 text-red-600' },
            { label: 'Reserved', value: summary.reserved_items, icon: <Lock className="w-4 h-4" />, cls: 'bg-indigo-50 text-indigo-600' },
            { label: 'Dues In', value: summary.dues_in_items, icon: <Clock className="w-4 h-4" />, cls: 'bg-blue-50 text-blue-600' },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className={`w-8 h-8 rounded-lg ${c.cls} flex items-center justify-center mb-2`}>{c.icon}</div>
              <div className="text-xl font-bold text-brand-900">{fmtNum(c.value, 0)}</div>
              <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
        <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
          <div className="w-full md:w-72">
            <Field label="Cari">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Kode / nama produk, batch…"
                  className="w-full pl-9 pr-3 py-2 border-[1.5px] border-gray-300 rounded-lg text-sm focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 outline-none"
                />
              </div>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Semua</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Lokasi">
              <Select value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">Semua</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={expiring}
              onChange={(e) => setExpiring(e.target.checked)}
              className="accent-brand-600 w-4 h-4"
            />
            Hanya segera expire
          </label>
          {year && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-sm font-semibold text-red-700">
              Expire {year}
              <button
                type="button"
                onClick={() => setYear('')}
                className="w-4 h-4 rounded-full hover:bg-red-200 flex items-center justify-center text-xs"
                title="Hapus filter tahun"
              >
                ✕
              </button>
            </div>
          )}
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 inline-flex items-center gap-2"
          >
            <Search className="w-4 h-4" /> Cari
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
        <div className="px-5 py-3.5 border-b border-gray-100 bg-brand-50/50 flex items-center justify-between">
          <h3 className="font-bold text-sm text-brand-700">Daftar Stok</h3>
        </div>
        {loading ? (
          <Spinner label="Memuat stok…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Tidak ada data stok" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1200px]">
              <thead>
                <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 text-left font-bold">Produk</th>
                  <th className="px-3 py-2.5 text-left font-bold">Kategori</th>
                  <th className="px-3 py-2.5 text-left font-bold">UOM Type</th>
                  <th className="px-3 py-2.5 text-center font-bold">Velocity</th>
                  <th className="px-3 py-2.5 text-left font-bold">Batch</th>
                  <th className="px-3 py-2.5 text-left font-bold">Lokasi</th>
                  <th className="px-3 py-2.5 text-right font-bold">Qty</th>
                  <th className="px-3 py-2.5 text-left font-bold">UOM</th>
                  <th className="px-3 py-2.5 text-right font-bold">Pallet</th>
                  <th className="px-3 py-2.5 text-left font-bold">Tgl Produksi</th>
                  <th className="px-3 py-2.5 text-left font-bold">Expire</th>
                  <th className="px-3 py-2.5 text-left font-bold">Status</th>
                  <th className="px-3 py-2.5 text-left font-bold">Hold</th>
                  <th className="px-3 py-2.5 text-right font-bold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const exp = expiryInfo(r.expiry_date);
                  return (
                    <tr key={r.id} className="hover:bg-brand-50/50">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-brand-800">{r.product_code}</div>
                        <div className="text-xs text-gray-500">{r.product_name}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{r.category || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{r.uom_type || '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {r.velocity_class ? (
                          <StatusBadge status={r.velocity_class} />
                        ) : (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{r.batch_number || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-700 font-mono text-xs">
                        {r.location || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold">{fmtNum(r.quantity, 0)}</td>
                      <td className="px-3 py-2.5 text-gray-600">{r.uom || '—'}</td>
                      <td className="px-3 py-2.5 text-right">{fmtNum(r.pallet, 0)}</td>
                      <td className="px-3 py-2.5 text-gray-600">{fmtDate(r.manufacture_date)}</td>
                      <td className={`px-3 py-2.5 ${expiryCls(exp.level)}`}>
                        <div>{fmtDate(r.expiry_date)}</div>
                        {exp.level !== 'none' && <div className="text-[10px] opacity-80">{exp.text}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={r.stock_status} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={r.hold_status || 'available'} />
                          {r.hold_status && r.hold_status !== 'available' && (
                            <span className="text-[10px] text-gray-400" title={r.hold_reason || ''}>
                              {r.hold_reason ? `: ${r.hold_reason}` : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {canWrite && (r.hold_status === 'available' || !r.hold_status) && (
                            <button
                              onClick={() => openHold(r)}
                              title="Hold / Quarantine"
                              className="p-1.5 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canWrite && r.hold_status && r.hold_status !== 'available' && (
                            <button
                              onClick={() => openRelease(r)}
                              title="Release Hold"
                              className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canWrite && (
                            <button
                              onClick={() => openTransfer(r)}
                              title="Transfer"
                              className="p-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canAdmin && (
                            <button
                              onClick={() => openAdjust(r)}
                              title="Adjust"
                              className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Card title="Stok per Area">
        {byLocation.length === 0 ? (
          <EmptyState message="Tidak ada data per area" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 text-left font-bold">Area</th>
                  <th className="px-3 py-2.5 text-right font-bold">Produk</th>
                  <th className="px-3 py-2.5 text-right font-bold">Total Qty</th>
                  <th className="px-3 py-2.5 text-right font-bold">Total Pallet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byLocation.map((b) => (
                  <tr key={b.area} className="hover:bg-brand-50/50">
                    <td className="px-3 py-2.5 font-semibold text-brand-800">{b.area || '—'}</td>
                    <td className="px-3 py-2.5 text-right">{fmtNum(b.products, 0)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{fmtNum(b.total_qty, 0)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtNum(b.total_pallet, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <datalist id="stock-locations">
        {locations.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      <Modal open={!!transferRow} onClose={() => setTransferRow(null)} title="Transfer Stok" size="sm">
        {transferRow && (
          <form onSubmit={submitTransfer} className="space-y-4">
            <div className="bg-brand-50 rounded-lg p-3 text-xs text-brand-800">
              <div className="flex justify-between">
                <span className="text-gray-500">Produk</span>
                <span className="font-semibold">
                  {transferRow.product_code} — {transferRow.product_name}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Batch · Lokasi</span>
                <span className="font-semibold">
                  {transferRow.batch_number || '—'} · {transferRow.location}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Qty tersedia</span>
                <span className="font-semibold">
                  {fmtNum(transferRow.quantity, 0)} {transferRow.uom}
                </span>
              </div>
            </div>
            <Field label="Lokasi Tujuan" required>
              <TextInput
                list="stock-locations"
                value={toLoc}
                onChange={(e) => setToLoc(e.target.value)}
                placeholder="Contoh: A-01-01"
                autoFocus
              />
            </Field>
            <Field label="Jumlah" hint="Kosongkan untuk memindahkan seluruh qty">
              <TextInput type="number" min={0} value={tQty} onChange={(e) => setTQty(e.target.value)} placeholder="Semua" />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTransferRow(null)}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || !toLoc.trim()}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? 'Memproses…' : 'Transfer'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!adjustRow} onClose={() => setAdjustRow(null)} title="Adjust Stok" size="sm">
        {adjustRow && (
          <form onSubmit={submitAdjust} className="space-y-4">
            <div className="bg-brand-50 rounded-lg p-3 text-xs text-brand-800">
              <div className="flex justify-between">
                <span className="text-gray-500">Produk</span>
                <span className="font-semibold">
                  {adjustRow.product_code} — {adjustRow.product_name}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Batch · Lokasi</span>
                <span className="font-semibold">
                  {adjustRow.batch_number || '—'} · {adjustRow.location}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Qty saat ini</span>
                <span className="font-semibold">
                  {fmtNum(adjustRow.quantity, 0)} {adjustRow.uom}
                </span>
              </div>
            </div>
            <Field label="Jumlah Baru" required>
              <TextInput type="number" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} placeholder="Qty baru" autoFocus />
            </Field>
            <Field label="Alasan" required>
              <TextArea value={adjReason} onChange={(e) => setAdjReason(e.target.value)} rows={3} placeholder="Alasan adjustment…" />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAdjustRow(null)}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || adjQty === '' || !adjReason.trim()}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!holdRow} onClose={() => setHoldRow(null)} title="Hold / Quarantine Stok" size="sm">
        {holdRow && (
          <form onSubmit={submitHold} className="space-y-4">
            <div className="bg-orange-50 rounded-lg p-3 text-xs text-orange-800">
              <div className="flex justify-between">
                <span className="text-gray-500">Produk</span>
                <span className="font-semibold">
                  {holdRow.product_code} — {holdRow.product_name}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Batch · Lokasi</span>
                <span className="font-semibold">
                  {holdRow.batch_number || '—'} · {holdRow.location}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Qty</span>
                <span className="font-semibold">
                  {fmtNum(holdRow.quantity, 0)} {holdRow.uom}
                </span>
              </div>
            </div>
            <Field label="Status Hold" required>
              <Select value={holdStatus} onChange={(e) => setHoldStatus(e.target.value)}>
                <option value="on_hold">On Hold</option>
                <option value="quarantine">Quarantine</option>
                <option value="damaged">Damaged</option>
              </Select>
            </Field>
            <Field label="Alasan" required>
              <TextArea value={holdReason} onChange={(e) => setHoldReason(e.target.value)} rows={3} placeholder="Alasan hold / quarantine…" autoFocus />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setHoldRow(null)}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || !holdReason.trim()}
                className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50"
              >
                {submitting ? 'Menyimpan…' : 'Hold'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!releaseRow} onClose={() => setReleaseRow(null)} title="Release Hold Stok" size="sm">
        {releaseRow && (
          <form onSubmit={submitRelease} className="space-y-4">
            <div className="bg-emerald-50 rounded-lg p-3 text-xs text-emerald-800">
              <div className="flex justify-between">
                <span className="text-gray-500">Produk</span>
                <span className="font-semibold">
                  {releaseRow.product_code} — {releaseRow.product_name}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Batch · Lokasi</span>
                <span className="font-semibold">
                  {releaseRow.batch_number || '—'} · {releaseRow.location}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Status hold</span>
                <span className="font-semibold">
                  <StatusBadge status={releaseRow.hold_status} />
                </span>
              </div>
              {releaseRow.hold_reason && (
                <div className="mt-1">
                  <span className="text-gray-500">Alasan hold: </span>
                  <span className="font-semibold">{releaseRow.hold_reason}</span>
                </div>
              )}
            </div>
            <Field label="Alasan Release" hint="Opsional">
              <TextArea value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} rows={3} placeholder="Alasan release…" autoFocus />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setReleaseRow(null)}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                {submitting ? 'Menyimpan…' : 'Release'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
