import { FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Plus, ArrowRight, Boxes, PackageX, Trash2, MapPin, Play, Zap } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { Field, TextInput, Select, Grid } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { fmtNum, fmtDate } from '@/lib/format';

interface Suggestion {
  target_id: number;
  location_id: number;
  pick_face_location: string;
  product_id: number;
  product_code: string;
  product_name: string;
  uom_type: string;
  uom_per_pallet: number;
  min_qty: number;
  max_qty: number;
  current_qty: number;
  shortage: number;
  sources: { location: string; available_qty: number; earliest_expiry: string | null; batch_count: number }[];
}

interface TargetRow {
  id: number;
  location_id: number;
  product_id: number;
  min_qty: number;
  max_qty: number;
  location_code: string;
  aisle: string | null;
  row_name: string | null;
  zone: string | null;
  product_code: string;
  product_name: string;
  uom_type: string;
  current_qty: number;
}

interface SearchProduct {
  id: number;
  text: string;
  product_code: string;
  product_name: string;
  uom: string;
  stock_qty: number;
}

export default function ReplenishmentPage() {
  const toast = useToast();
  const { canWrite } = useAuth();

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [targetModal, setTargetModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [locId, setLocId] = useState('');
  const [locOptions, setLocOptions] = useState<{ id: number; code: string }[]>([]);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [productResults, setProductResults] = useState<SearchProduct[]>([]);
  const [productId, setProductId] = useState<number | null>(null);
  const [productLabel, setProductLabel] = useState('');
  const [minQty, setMinQty] = useState('');
  const [maxQty, setMaxQty] = useState('');
  const [saving, setSaving] = useState(false);

  const [transferSug, setTransferSug] = useState<Suggestion | null>(null);
  const [transferFrom, setTransferFrom] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [demandText, setDemandText] = useState('');
  const [demandResults, setDemandResults] = useState<SearchProduct[]>([]);
  const [demandSearching, setDemandSearching] = useState(false);
  const [demandProduct, setDemandProduct] = useState<SearchProduct | null>(null);
  const [demandQty, setDemandQty] = useState('');
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandResult, setDemandResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, tRes] = await Promise.all([
        api('replenishment', 'list'),
        api('replenishment', 'targets'),
      ]);
      setSuggestions((sRes.suggestions || []) as Suggestion[]);
      setTargets((tRes.targets || []) as TargetRow[]);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat data replenishment');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openAddTarget = () => {
    setEditingId(null);
    setLocId('');
    setSearchText('');
    setProductResults([]);
    setProductId(null);
    setProductLabel('');
    setMinQty('');
    setMaxQty('');
    setTargetModal(true);
  };

  const openEditTarget = (t: TargetRow) => {
    setEditingId(t.id);
    setLocId(String(t.location_id));
    setSearchText(`${t.product_code} — ${t.product_name}`);
    setProductResults([]);
    setProductId(t.product_id);
    setProductLabel(`${t.product_code} — ${t.product_name}`);
    setMinQty(String(t.min_qty));
    setMaxQty(String(t.max_qty));
    setTargetModal(true);
  };

  const loadLocations = async () => {
    try {
      const res = await api('locations', 'all');
      const rows = (res.rows || []) as any[];
      setLocOptions(
        rows
          .filter((l) => l && l.id != null && (l.location_code || l.code))
          .map((l) => ({ id: Number(l.id), code: String(l.location_code || l.code) })),
      );
    } catch {
      setLocOptions([]);
    }
  };

  useEffect(() => {
    if (!targetModal) return;
    loadLocations();
  }, [targetModal]);

  useEffect(() => {
    if (!targetModal) return;
    const t = setTimeout(() => {
      const s = searchText.trim();
      if (!s || productId) {
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
  }, [searchText, targetModal, productId]);

  useEffect(() => {
    const t = setTimeout(() => {
      const s = demandText.trim();
      if (!s || demandProduct) {
        setDemandResults([]);
        return;
      }
      setDemandSearching(true);
      api('inbound', 'search_products', { params: { q: s } })
        .then((res) => setDemandResults((res.results || []) as SearchProduct[]))
        .catch(() => setDemandResults([]))
        .finally(() => setDemandSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [demandText, demandProduct]);

  const saveTarget = async (e: FormEvent) => {
    e.preventDefault();
    if (!locId || !productId) {
      toast('error', 'Pilih lokasi dan produk terlebih dahulu');
      return;
    }
    setSaving(true);
    try {
      await api('replenishment', 'save_target', {
        method: 'POST',
        body: {
          location_id: Number(locId),
          product_id: productId,
          min_qty: minQty === '' ? 0 : Number(minQty),
          max_qty: maxQty === '' ? 0 : Number(maxQty),
        },
      });
      toast('success', editingId ? 'Target diperbarui' : 'Target disimpan');
      setTargetModal(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan target');
    } finally {
      setSaving(false);
    }
  };

  const deleteTarget = async (id: number) => {
    if (!window.confirm('Hapus target ini?')) return;
    try {
      await api('replenishment', 'delete_target', { method: 'POST', body: { id } });
      toast('success', 'Target dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus target');
    }
  };

  const openTransfer = (s: Suggestion) => {
    setTransferSug(s);
    const src = s.sources?.[0];
    setTransferFrom(src?.location || '');
    setTransferQty(String(Math.min(Number(s.shortage), src?.available_qty ?? Number(s.shortage))));
    setTransferReason('Replenishment pick-face (otomatis)');
  };

  const submitTransfer = async (e: FormEvent) => {
    e.preventDefault();
    if (!transferSug) return;
    const qtyNum = Number(transferQty);
    if (!transferFrom) {
      toast('error', 'Pilih lokasi sumber');
      return;
    }
    if (transferQty === '' || isNaN(qtyNum) || qtyNum <= 0) {
      toast('error', 'Jumlah harus lebih dari 0');
      return;
    }
    setSubmitting(true);
    try {
      await api('bintransfer', 'create', {
        method: 'POST',
        body: {
          product_id: transferSug.product_id,
          transfer_date: new Date().toISOString().slice(0, 10),
          from_location: transferFrom,
          to_location: transferSug.pick_face_location,
          quantity: qtyNum,
          uom: transferSug.uom_type || undefined,
          reason: transferReason.trim() || undefined,
          transfer_type: 'REPLENISHMENT',
          is_breakdown: 1,
        },
      });
      toast('success', 'Bin transfer berhasil dibuat');
      setTransferSug(null);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal membuat transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const runDemand = async (create: boolean) => {
    if (!demandProduct) {
      toast('error', 'Pilih produk terlebih dahulu');
      return;
    }
    const qtyNum = Number(demandQty);
    if (demandQty === '' || isNaN(qtyNum) || qtyNum <= 0) {
      toast('error', 'Jumlah kebutuhan harus lebih dari 0');
      return;
    }
    setDemandLoading(true);
    try {
      const res = await api('replenishment', 'for_demand', {
        method: 'POST',
        body: { product_id: demandProduct.id, quantity: qtyNum, create_transfer: create },
      });
      setDemandResult(res);
      if (create && res.transfer_number) toast('success', `Transfer dibuat: ${res.transfer_number}`);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal memproses demand');
    } finally {
      setDemandLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Replenishment"
        subtitle="Saran isi ulang lokasi pick-face dari stok bulk/reserve"
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
              <button
                onClick={load}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 border border-white/30 text-white text-sm font-semibold hover:bg-white/25"
              >
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
              <button
                onClick={openAddTarget}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 border border-white/30 text-white text-sm font-semibold hover:bg-white/25"
              >
                <Plus className="w-4 h-4" /> Add Target
              </button>
            </div>
          ) : undefined
        }
      />

      <Card title={`Saran Replenishment (${suggestions.length})`}>
        {loading ? (
          <Spinner label="Memuat…" />
        ) : suggestions.length === 0 ? (
          <EmptyState message="Semua target pick-face berada di atas min_qty. Tidak ada saran." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Pick-Face</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Produk</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Current</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Min</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Kurang</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Sumber (bulk/reserve)</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.target_id} className="border-t border-gray-100 hover:bg-brand-50 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-brand-700">{s.pick_face_location}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-gray-800">{s.product_code}</div>
                      <div className="text-[11px] text-gray-500">{s.product_name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmtNum(s.current_qty, 2)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmtNum(s.min_qty, 2)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-red-600">{fmtNum(s.shortage, 2)}</td>
                    <td className="px-3 py-2.5">
                      {s.sources && s.sources.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {s.sources.slice(0, 3).map((src) => (
                            <div key={src.location} className="flex items-center gap-1.5 font-mono text-xs text-gray-700">
                              <MapPin className="w-3 h-3 text-brand-400" />
                              {src.location}
                              <span className="text-gray-400">·</span>
                              <span className="font-semibold text-emerald-700">{fmtNum(src.available_qty, 2)}</span>
                              {src.earliest_expiry && <span className="text-gray-400">· {fmtDate(src.earliest_expiry)}</span>}
                              {src.batch_count > 1 && <span className="text-gray-400">· {src.batch_count} batch</span>}
                            </div>
                          ))}
                          {s.sources.length > 3 && <div className="text-[11px] text-gray-400">+{s.sources.length - 3} lainnya</div>}
                        </div>
                      ) : (
                        <span className="text-[11px] text-amber-600">Tidak ada sumber stok tersedia</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => openTransfer(s)}
                        disabled={!canWrite || !s.sources?.length}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3 h-3" /> Create Transfer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Demand-Driven Replenishment">
        <div className="text-sm text-gray-500 mb-4">
          Masukkan kebutuhan (demand) untuk suatu SKU. Sistem membandingkan stok pick-face (Level A) terhadap
          kebutuhan; bila kurang, sistem mencari stok bulk/reserve (B–E, FEFO) dan dapat membuat transfer top-up
          otomatis ke lokasi pick-face.
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Produk" required>
            <TextInput
              value={demandText}
              onChange={(e) => {
                setDemandText(e.target.value);
                setDemandProduct(null);
                setDemandResult(null);
              }}
              placeholder="Cari kode / nama produk…"
            />
            {demandText && !demandProduct && demandResults.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-md divide-y divide-gray-100">
                {demandResults.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => {
                      setDemandProduct(p);
                      setDemandText(`${p.product_code} — ${p.product_name}`);
                      setDemandResults([]);
                      setDemandResult(null);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50"
                  >
                    <span className="font-semibold text-brand-800">{p.product_code}</span> — {p.product_name}
                  </button>
                ))}
              </div>
            )}
            {demandSearching && <div className="mt-1 text-xs text-gray-400">Mencari…</div>}
            {demandProduct && <div className="mt-1 text-xs text-emerald-600 font-semibold">{demandProduct.product_code} — {demandProduct.product_name}</div>}
          </Field>
          <Field label="Kebutuhan (Qty)" required>
            <TextInput type="number" min={0} step="0.01" value={demandQty} onChange={(e) => setDemandQty(e.target.value)} placeholder="cth: 500" />
          </Field>
          <div className="flex items-end gap-2">
            <button
              onClick={() => runDemand(false)}
              disabled={demandLoading}
              className="flex-1 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
            >
              <Zap className="w-4 h-4 inline-block mr-1" />
              {demandLoading ? 'Memeriksa…' : 'Cek (dry-run)'}
            </button>
            <button
              onClick={() => runDemand(true)}
              disabled={demandLoading || !canWrite}
              className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              Cek & Buat Transfer
            </button>
          </div>
        </div>

        {demandResult && (
          <div className={`mt-4 rounded-xl border p-4 text-sm ${demandResult.triggered ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`}>
            {demandResult.triggered ? (
              <>
                <div className="font-bold text-amber-800 mb-2">Stok pick-face kurang — replenishment dibutuhkan</div>
                <div className="grid md:grid-cols-4 gap-3">
                  <Metric label="Kebutuhan" value={fmtNum(demandResult.demand_qty, 0)} />
                  <Metric label="Stok Pick (A)" value={fmtNum(demandResult.pick_available, 0)} />
                  <Metric label="Shortage" value={fmtNum(demandResult.shortage, 0)} accent />
                  <Metric label="Tersedia Sumber" value={fmtNum(demandResult.available, 0)} />
                </div>
                <div className="mt-2 text-xs text-amber-700">
                  Target: <span className="font-mono font-bold">{demandResult.target || '—'}</span>
                  {demandResult.transfer_number && (
                    <span className="ml-2">· Transfer: <span className="font-mono font-bold">{demandResult.transfer_number}</span></span>
                  )}
                </div>
                {demandResult.source?.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[11px] uppercase tracking-wider text-amber-600 font-bold mb-1">Sumber (FEFO B–E)</div>
                    <div className="flex flex-col gap-1">
                      {demandResult.source.map((src: any) => (
                        <div key={src.location} className="flex items-center gap-2 font-mono text-xs text-amber-800">
                          <MapPin className="w-3 h-3" /> {src.location}
                          <span className="text-amber-600">Lv {src.level}</span>
                          <span className="font-bold">{fmtNum(src.take_qty, 2)}</span>
                          {src.batch && <span className="text-amber-600">· {src.batch}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="font-bold text-emerald-800">
                ✓ {demandResult.message || 'Stok pick-face mencukupi kebutuhan.'}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title={`Target Pick-Face (${targets.length})`} className={canWrite ? '' : 'mb-0'}>
        {loading ? (
          <Spinner label="Memuat…" />
        ) : targets.length === 0 ? (
          <EmptyState message="Belum ada target. Tambahkan target untuk memulai." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Lokasi</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Produk</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Current</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Min</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Max</th>
                  {canWrite && <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-brand-50 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-xs text-brand-700">{t.location_code}</div>
                      <div className="text-[11px] text-gray-400">{[t.zone, t.aisle, t.row_name].filter(Boolean).join(' · ') || '—'}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-gray-800">{t.product_code}</div>
                      <div className="text-[11px] text-gray-500">{t.product_name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmtNum(t.current_qty, 2)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmtNum(t.min_qty, 2)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{fmtNum(t.max_qty, 2)}</td>
                    {canWrite && (
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditTarget(t)}
                            className="px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 border border-brand-200 text-xs font-semibold hover:bg-brand-100"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteTarget(t.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 border border-red-200 text-xs font-semibold hover:bg-red-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
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

      <Modal open={targetModal} onClose={() => setTargetModal(false)} title={editingId ? 'Edit Target Pick-Face' : 'Tambah Target Pick-Face'} size="md">
        <form onSubmit={saveTarget} className="space-y-4">
          <Grid cols={2}>
            <Field label="Lokasi Pick-Face" required>
              <Select value={locId} onChange={(e) => setLocId(e.target.value)}>
                <option value="">— pilih lokasi —</option>
                {locOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Produk" required>
              <TextInput
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setProductId(null);
                  setProductLabel('');
                }}
                placeholder="Cari kode / nama produk…"
              />
              {searchText && !productId && productResults.length > 0 && (
                <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-md divide-y divide-gray-100">
                  {productResults.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setProductId(p.id);
                        setProductLabel(`${p.product_code} — ${p.product_name}`);
                        setSearchText(`${p.product_code} — ${p.product_name}`);
                        setProductResults([]);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50"
                    >
                      <span className="font-semibold text-brand-800">{p.product_code}</span> — {p.product_name}
                    </button>
                  ))}
                </div>
              )}
              {searching && <div className="mt-1 text-xs text-gray-400">Mencari…</div>}
              {productId && <div className="mt-1 text-xs text-emerald-600 font-semibold">{productLabel}</div>}
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Min Qty" required hint="Di bawah nilai ini akan muncul sebagai saran">
              <TextInput type="number" min={0} step="0.01" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Max Qty" required hint="0 = tanpa batas atas">
              <TextInput type="number" min={0} step="0.01" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} placeholder="0" />
            </Field>
          </Grid>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setTargetModal(false)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">
              Batal
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!transferSug} onClose={() => setTransferSug(null)} title="Buat Bin Transfer (Replenishment)" size="md">
        {transferSug && (
          <form onSubmit={submitTransfer} className="space-y-4">
            <div className="rounded-lg bg-brand-50 border border-brand-200 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold text-brand-800">{transferSug.pick_face_location}</span>
                <ArrowRight className="w-4 h-4 text-brand-500" />
                <span className="font-mono font-semibold text-brand-800">{transferFrom || '—'}</span>
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {transferSug.product_code} — {transferSug.product_name} · kekurangan {fmtNum(transferSug.shortage, 2)} {transferSug.uom_type}
              </div>
            </div>
            <Field label="Dari Lokasi (bulk/reserve)" required>
              <Select value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)}>
                <option value="">— pilih lokasi sumber —</option>
                {(transferSug.sources || []).map((src) => (
                  <option key={src.location} value={src.location}>
                    {src.location} ({fmtNum(src.available_qty, 2)} {transferSug.uom_type}{src.earliest_expiry ? ` · ${fmtDate(src.earliest_expiry)}` : ''})
                  </option>
                ))}
              </Select>
            </Field>
            <Grid cols={2}>
              <Field label="Jumlah" required>
                <TextInput type="number" min={0} step="0.01" value={transferQty} onChange={(e) => setTransferQty(e.target.value)} />
              </Field>
              <Field label="Tanggal">
                <TextInput type="date" value={new Date().toISOString().slice(0, 10)} disabled />
              </Field>
            </Grid>
            <Field label="Alasan">
              <TextInput value={transferReason} onChange={(e) => setTransferReason(e.target.value)} placeholder="Catatan / alasan…" />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setTransferSug(null)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">
                Batal
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                {submitting ? 'Menyimpan…' : 'Buat Transfer'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-white border border-amber-200 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-gray-400 font-bold">{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-red-600' : 'text-gray-800'}`}>{value}</div>
    </div>
  );
}