import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Search, ArrowRight, Plus, Play, X, Boxes } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import Spinner from '@/components/Spinner';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, Select, TextArea, Grid } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { fmtNum, fmtDate, todayISO } from '@/lib/format';

const PER_PAGE = 20;
const STATUS_OPTIONS = ['Pending', 'Completed', 'Cancelled'];

interface BinTransferRow {
  id: number;
  transfer_number: string;
  transfer_date: string;
  product_id: number;
  product_code: string;
  product_name: string;
  batch_number: string;
  from_location: string;
  to_location: string;
  quantity: number;
  uom: string;
  reason: string;
  status: string;
  created_by_name: string;
  completed_by_name: string;
}

interface SearchProduct {
  id: number;
  text: string;
  product_code: string;
  product_name: string;
  uom: string;
  stock_qty: number;
}

interface LocWithStock {
  location: string;
  total_qty: number;
  uom: string;
  earliest_expiry: string;
  batch_count: number;
}

export default function BinTransferPage() {
  const toast = useToast();
  const { canWrite } = useAuth();

  const [rows, setRows] = useState<BinTransferRow[]>([]);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [detail, setDetail] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [productResults, setProductResults] = useState<SearchProduct[]>([]);
  const [productId, setProductId] = useState<number | null>(null);
  const [productName, setProductName] = useState('');
  const [locationsWithStock, setLocationsWithStock] = useState<LocWithStock[]>([]);
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const [fromLoc, setFromLoc] = useState('');
  const [toLoc, setToLoc] = useState('');
  const [qty, setQty] = useState('');
  const [uom, setUom] = useState('');
  const [reason, setReason] = useState('');
  const [transferDate, setTransferDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('bintransfer', 'list', {
        params: { status, page, per_page: PER_PAGE },
      });
      setRows((res.rows || []) as BinTransferRow[]);
      const t = Number(res.total) || 0;
      setTotal(t);
      setTotalPages(Math.max(1, Math.ceil(t / PER_PAGE)));
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat transfer');
    } finally {
      setLoading(false);
    }
  }, [status, page, refreshKey, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleStatusChange = (v: string) => {
    setStatus(v);
    setPage(1);
    setRefreshKey((k) => k + 1);
  };

  const openDetail = async (id: number) => {
    try {
      const res = await api('bintransfer', 'detail', { params: { id } });
      setDetail(res.transfer);
      setDetailOpen(true);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat detail');
    }
  };

  const execute = async (id: number) => {
    try {
      await api('bintransfer', 'execute', { method: 'POST', body: { id } });
      toast('success', 'Transfer dieksekusi');
      load();
    } catch (e: any) {
      toast('error', e.message || 'Gagal mengeksekusi transfer');
    }
  };

  const cancel = async (id: number) => {
    try {
      await api('bintransfer', 'cancel', { method: 'POST', body: { id } });
      toast('success', 'Transfer dibatalkan');
      load();
    } catch (e: any) {
      toast('error', e.message || 'Gagal membatalkan transfer');
    }
  };

  const openModal = () => {
    setSearchText('');
    setProductResults([]);
    setProductId(null);
    setProductName('');
    setLocationsWithStock([]);
    setFromLoc('');
    setToLoc('');
    setQty('');
    setUom('');
    setReason('');
    setTransferDate(todayISO());
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    api('locations', 'all')
      .then((res) => {
        setAllLocations(
          (res.rows || []).map((l: any) => (typeof l === 'string' ? l : l.location_code || l.code || '')),
        );
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const s = searchText.trim();
      if (!s) {
        setProductResults([]);
        return;
      }
      setSearching(true);
      api('inbound', 'search_products', { params: { q: s } })
        .then((res) => setProductResults((res.results || []) as SearchProduct[]))
        .catch(() => setProductResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [searchText, open]);

  const selectProduct = (p: SearchProduct) => {
    setProductId(p.id);
    setProductName(`${p.product_code} — ${p.product_name}`);
    setSearchText(`${p.product_code} — ${p.product_name}`);
    setUom(p.uom || '');
    setProductResults([]);
    api('bintransfer', 'locations_with_stock', { params: { product_id: p.id } })
      .then((res) => setLocationsWithStock((res.rows || []) as LocWithStock[]))
      .catch(() => setLocationsWithStock([]));
  };

  const clearProduct = () => {
    setProductId(null);
    setProductName('');
    setSearchText('');
    setLocationsWithStock([]);
    setFromLoc('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!productId) {
      toast('error', 'Pilih produk terlebih dahulu');
      return;
    }
    if (!fromLoc) {
      toast('error', 'Pilih lokasi asal');
      return;
    }
    if (!toLoc.trim()) {
      toast('error', 'Isi lokasi tujuan');
      return;
    }
    const qtyNum = Number(qty);
    if (qty === '' || isNaN(qtyNum) || qtyNum <= 0) {
      toast('error', 'Jumlah harus lebih dari 0');
      return;
    }
    setSubmitting(true);
    try {
      await api('bintransfer', 'create', {
        method: 'POST',
        body: {
          product_id: productId,
          transfer_date: transferDate,
          from_location: fromLoc,
          to_location: toLoc.trim(),
          quantity: qtyNum,
          uom: uom || undefined,
          reason: reason || undefined,
        },
      });
      toast('success', 'Bin transfer berhasil dibuat');
      setOpen(false);
      if (page !== 1) setPage(1);
      else load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal membuat transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const availableTotal = locationsWithStock.reduce((s, l) => s + (Number(l.total_qty) || 0), 0);

  return (
    <div>
      <PageHeader
        title="Bin Transfer"
        subtitle="Pindahkan stok antar lokasi penyimpanan"
        actions={
          canWrite ? (
            <button
              onClick={openModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/15 border border-white/30 text-white text-sm font-semibold hover:bg-white/25"
            >
              <Plus className="w-4 h-4" /> New Transfer
            </button>
          ) : undefined
        }
      />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 bg-brand-50/50 flex items-center justify-between">
          <h3 className="font-bold text-sm text-brand-700">Daftar Transfer</h3>
          <div className="w-40">
            <Select value={status} onChange={(e) => handleStatusChange(e.target.value)} className="!py-1.5 text-xs">
              <option value="">Semua Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {loading ? (
          <Spinner label="Memuat transfer…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Tidak ada data transfer" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 text-left font-bold">No. Transfer</th>
                  <th className="px-3 py-2.5 text-left font-bold">Tanggal</th>
                  <th className="px-3 py-2.5 text-left font-bold">Produk</th>
                  <th className="px-3 py-2.5 text-left font-bold">Batch</th>
                  <th className="px-3 py-2.5 text-left font-bold">Lokasi</th>
                  <th className="px-3 py-2.5 text-right font-bold">Qty</th>
                  <th className="px-3 py-2.5 text-left font-bold">UOM</th>
                  <th className="px-3 py-2.5 text-left font-bold">Alasan</th>
                  <th className="px-3 py-2.5 text-left font-bold">Status</th>
                  <th className="px-3 py-2.5 text-left font-bold">Dibuat</th>
                  <th className="px-3 py-2.5 text-left font-bold">Dieksekusi</th>
                  <th className="px-3 py-2.5 text-right font-bold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => openDetail(r.id)} className="hover:bg-brand-50/50 cursor-pointer">
                    <td className="px-3 py-2.5 font-semibold text-brand-800">{r.transfer_number}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(r.transfer_date)}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-brand-800">{r.product_code}</div>
                      <div className="text-xs text-gray-500">{r.product_name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{r.batch_number || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-gray-700">{r.from_location}</span>
                      <ArrowRight className="w-3 h-3 inline mx-1 text-brand-500" />
                      <span className="font-medium text-gray-700">{r.to_location}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold">{fmtNum(r.quantity, 0)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.uom || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500 max-w-[150px] truncate" title={r.reason || ''}>
                      {r.reason || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{r.created_by_name || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.completed_by_name || '—'}</td>
                    <td className="px-3 py-2.5">
                      {r.status === 'Pending' && (
                        <div onClick={(e) => e.stopPropagation()} className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => execute(r.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100"
                          >
                            <Play className="w-3 h-3" /> Execute
                          </button>
                          <ConfirmButton
                            label="Cancel"
                            confirmText="Batalkan transfer ini?"
                            onConfirm={() => cancel(r.id)}
                            variant="danger"
                          >
                            Cancel
                          </ConfirmButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-3.5 border-t border-gray-100">
          <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Bin Transfer Baru" size="md">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Cari Produk" required>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <TextInput
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Kode / nama produk…"
                className="pl-9"
                autoFocus
              />
            </div>
            {searchText && !productId && productResults.length > 0 && (
              <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-md divide-y divide-gray-100">
                {productResults.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50"
                  >
                    <span className="font-semibold text-brand-800">{p.product_code}</span> — {p.product_name}
                    <span className="text-xs text-gray-400 ml-2">
                      Stok: {fmtNum(p.stock_qty, 0)} {p.uom}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {searching && <div className="mt-1 text-xs text-gray-400">Mencari…</div>}
            {productId && (
              <div className="mt-2 flex items-center justify-between bg-brand-50 rounded-lg px-3 py-2 text-sm">
                <span className="font-semibold text-brand-800">{productName}</span>
                <button type="button" onClick={clearProduct} className="text-gray-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </Field>

          <Grid cols={2}>
            <Field label="Dari Lokasi" required>
              <Select
                value={fromLoc}
                onChange={(e) => setFromLoc(e.target.value)}
                disabled={!productId || locationsWithStock.length === 0}
              >
                <option value="">— pilih lokasi —</option>
                {locationsWithStock.map((l) => (
                  <option key={l.location} value={l.location}>
                    {l.location} ({fmtNum(l.total_qty, 0)} {l.uom || 'unit'})
                  </option>
                ))}
              </Select>
              {productId && locationsWithStock.length === 0 && (
                <div className="text-[11px] text-red-500 mt-1">Tidak ada stok untuk produk ini</div>
              )}
            </Field>
            <Field label="Ke Lokasi" required hint="Ketik untuk memilih lokasi tujuan">
              <TextInput list="all-locations" value={toLoc} onChange={(e) => setToLoc(e.target.value)} placeholder="Contoh: B-02-03" />
            </Field>
          </Grid>

          {productId && locationsWithStock.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-brand-700 bg-brand-50 rounded-lg px-3 py-1.5">
              <Boxes className="w-3.5 h-3.5" />
              Stok tersedia: {fmtNum(availableTotal, 0)} {uom || 'unit'} di {locationsWithStock.length} lokasi
            </div>
          )}

          <Grid cols={3}>
            <Field label="Jumlah" required>
              <TextInput type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
            </Field>
            <Field label="UOM">
              <TextInput value={uom} onChange={(e) => setUom(e.target.value)} placeholder="PCS" />
            </Field>
            <Field label="Tanggal Transfer" required>
              <TextInput type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
            </Field>
          </Grid>

          <Field label="Alasan">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Catatan / alasan transfer…" />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Menyimpan…' : 'Buat Transfer'}
            </button>
          </div>
        </form>
        <datalist id="all-locations">
          {allLocations.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </Modal>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Detail Transfer" size="md">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">No. Transfer</span>
              <span className="font-bold text-brand-800">{detail.transfer_number}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Status</span>
              <StatusBadge status={detail.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Produk</span>
              <span className="font-semibold">
                {detail.product_code} — {detail.product_name}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Batch</span>
              <span>{detail.batch_number || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Lokasi</span>
              <span className="font-semibold">
                {detail.from_location} <ArrowRight className="w-3 h-3 inline text-brand-600" /> {detail.to_location}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Jumlah</span>
              <span className="font-semibold">
                {fmtNum(detail.quantity, 0)} {detail.uom}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Tanggal</span>
              <span>{fmtDate(detail.transfer_date)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Dibuat oleh</span>
              <span>{detail.created_by_name || '—'}</span>
            </div>
            {detail.completed_by_name && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Dieksekusi oleh</span>
                <span>{detail.completed_by_name}</span>
              </div>
            )}
            {detail.reason && (
              <div>
                <div className="text-gray-500 mb-1">Alasan</div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">{detail.reason}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
