import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Plus, Layers, Search, X, Eye, Truck, CalendarClock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { Field, TextInput, Grid } from '@/components/Field';
import StatusBadge from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { fmtNum, fmtDateTime } from '@/lib/format';

interface WaveRow {
  id: number;
  wave_number: string;
  status: string;
  carrier: string | null;
  cutoff_time: string | null;
  order_count: number;
  item_count: number;
  picklist_id: number | null;
  picklist_number: string | null;
  picklist_status: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface CandidateOrder {
  id: number;
  order_number: string;
  order_date: string;
  so_number: string | null;
  do_number: string | null;
  destination: string | null;
  kota: string | null;
  armada_no: string | null;
  container_no: string | null;
  customer_name: string;
  customer_code: string;
  total_items: number;
  total_qty: number;
}

interface WaveDetail extends WaveRow {
  orders: CandidateOrder[];
  picklist: { id: number; picklist_number: string; status: string } | null;
}

const WAVE_STATUSES = ['Planning', 'Active', 'Completed', 'Cancelled'];

export default function WavesPage() {
  const toast = useToast();
  const { canWrite } = useAuth();

  const [waves, setWaves] = useState<WaveRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [newOpen, setNewOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateOrder[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [carrier, setCarrier] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [skipMsg, setSkipMsg] = useState('');

  const [detail, setDetail] = useState<WaveDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('waves', 'list');
      setWaves((res.rows || []) as WaveRow[]);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat wave');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = async () => {
    setNewOpen(true);
    setSelected(new Set());
    setCarrier('');
    setCutoff('');
    setSearch('');
    setSkipMsg('');
    try {
      const res = await api('waves', 'candidate_orders');
      setCandidates((res.orders || []) as CandidateOrder[]);
    } catch {
      setCandidates([]);
    }
  };

  const filteredCandidates = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return candidates;
    return candidates.filter((c) =>
      [c.order_number, c.so_number, c.do_number, c.customer_name, c.destination, c.kota, c.armada_no, c.container_no]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [candidates, search]);

  const toggleOrder = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitNew = async (e: FormEvent) => {
    e.preventDefault();
    if (selected.size === 0) {
      toast('error', 'Pilih minimal satu outbound order');
      return;
    }
    setCreating(true);
    setSkipMsg('');
    try {
      const res = await api('waves', 'create', {
        method: 'POST',
        body: {
          order_ids: [...selected],
          carrier: carrier.trim() || undefined,
          cutoff_time: cutoff || undefined,
        },
      });
      toast('success', 'Wave berhasil dibuat');
      setNewOpen(false);
      const skipped: number[] = res.skipped || [];
      if (skipped.length) {
        toast('info', 'Sebagian order dilewati (bukan status Open / sudah ada picklist): ' + skipped.join(', '));
      }
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal membuat wave');
    } finally {
      setCreating(false);
    }
  };

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await api('waves', 'detail', { params: { id } });
      setDetail((res.wave || null) as WaveDetail | null);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat detail wave');
    } finally {
      setDetailLoading(false);
    }
  };

  const cancelWave = async (w: WaveRow) => {
    if (!window.confirm(`Batalkan wave ${w.wave_number}? Picklist terkait (jika masih Draft) akan dihapus.`)) return;
    try {
      await api('waves', 'cancel', { method: 'POST', body: { id: w.id } });
      toast('success', 'Wave dibatalkan');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal membatalkan wave');
    }
  };

  return (
    <div>
      <PageHeader
        title="Wave Planning"
        subtitle="Kelompokkan beberapa outbound order menjadi satu picklist terpadu"
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
                onClick={openNew}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 border border-white/30 text-white text-sm font-semibold hover:bg-white/25"
              >
                <Plus className="w-4 h-4" /> New Wave
              </button>
            </div>
          ) : undefined
        }
      />

      <Card title={`Waves (${waves.length})`}>
        {loading ? (
          <Spinner label="Memuat…" />
        ) : waves.length === 0 ? (
          <EmptyState message="Belum ada wave. Buat wave untuk menggabungkan beberapa outbound order." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Wave</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Status</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Carrier</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Cutoff</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Orders</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Items</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Picklist</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Dibuat</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {waves.map((w) => (
                  <tr key={w.id} className="border-t border-gray-100 hover:bg-brand-50 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-xs text-brand-700">{w.wave_number}</div>
                      <div className="text-[11px] text-gray-400">{fmtDateTime(w.created_at)}</div>
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={w.status} /></td>
                    <td className="px-3 py-2.5 text-gray-700">{w.carrier || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700">{w.cutoff_time ? fmtDateTime(w.cutoff_time) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{w.order_count}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{w.item_count}</td>
                    <td className="px-3 py-2.5">
                      {w.picklist_id ? (
                        <Link to={`/picklist/${w.picklist_id}`} className="text-brand-600 hover:underline">
                          {w.picklist_number || `#${w.picklist_id}`}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">{w.created_by_name || '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openDetail(w.id)}
                          className="px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 border border-brand-200 text-xs font-semibold hover:bg-brand-100"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                        {canWrite && w.status !== 'Completed' && w.status !== 'Cancelled' && (
                          <button
                            onClick={() => cancelWave(w)}
                            className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 border border-red-200 text-xs font-semibold hover:bg-red-100"
                          >
                            Batal
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Buat Wave Baru" size="lg">
        <form onSubmit={submitNew} className="space-y-4">
          <Grid cols={2}>
            <Field label="Carrier / Armada">
              <TextInput value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="cth: Truk 1" />
            </Field>
            <Field label="Cutoff Time">
              <TextInput type="datetime-local" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
            </Field>
          </Grid>
          <Field label="Pilih Outbound Order" required hint={`${selected.size} order dipilih`}>
            <div className="relative mb-2">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nomor order / SO / DO / customer…"
                className="pl-9"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
              {filteredCandidates.length === 0 ? (
                <div className="px-3 py-4 text-sm text-gray-500">Tidak ada outbound order Open yang tersedia.</div>
              ) : (
                filteredCandidates.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-brand-50 ${checked ? 'bg-brand-50/60' : ''}`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleOrder(c.id)} className="mt-1 accent-brand-600" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-brand-800">{c.order_number}</span>
                          {c.so_number && <span className="text-[11px] text-gray-500">SO {c.so_number}</span>}
                          {c.do_number && <span className="text-[11px] text-gray-500">DO {c.do_number}</span>}
                        </div>
                        <div className="text-xs text-gray-600">
                          {c.customer_name}
                          {c.destination && ` · ${c.destination}`}
                          {c.kota && ` · ${c.kota}`}
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {c.total_items} item · {fmtNum(c.total_qty, 2)}
                          {c.armada_no && <span className="ml-2 inline-flex items-center gap-1"><Truck className="w-3 h-3" />{c.armada_no}</span>}
                          {c.container_no && <span className="ml-2 inline-flex items-center gap-1"><Layers className="w-3 h-3" />{c.container_no}</span>}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </Field>
          {skipMsg && <div className="text-xs text-amber-600">{skipMsg}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setNewOpen(false)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">
              Batal
            </button>
            <button type="submit" disabled={creating || selected.size === 0} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
              {creating ? 'Membuat…' : `Buat Wave (${selected.size})`}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Detail ${detail.wave_number}` : 'Detail Wave'} size="lg">
        {detailLoading ? (
          <Spinner label="Memuat detail…" />
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <StatusBadge status={detail.status} />
              {detail.carrier && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                  <Truck className="w-3.5 h-3.5 text-brand-500" /> {detail.carrier}
                </span>
              )}
              {detail.cutoff_time && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                  <CalendarClock className="w-3.5 h-3.5 text-brand-500" /> Cutoff {fmtDateTime(detail.cutoff_time)}
                </span>
              )}
            </div>
            {detail.picklist && (
              <div className="rounded-lg bg-brand-50 border border-brand-200 px-4 py-3 text-sm">
                <span className="text-gray-500">Picklist:</span>{' '}
                <Link to={`/picklist/${detail.picklist.id}`} className="font-semibold text-brand-700 hover:underline">
                  {detail.picklist.picklist_number}
                </Link>{' '}
                <StatusBadge status={detail.picklist.status} />
              </div>
            )}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Outbound Orders ({detail.orders.length})</div>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2 bg-gray-50">Order</th>
                      <th className="px-3 py-2 bg-gray-50">Customer</th>
                      <th className="px-3 py-2 bg-gray-50">Tujuan</th>
                      <th className="px-3 py-2 bg-gray-50 text-right">Items</th>
                      <th className="px-3 py-2 bg-gray-50 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.orders.map((o) => (
                      <tr key={o.id} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          <Link to={`/outbound/${o.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                            {o.order_number}
                          </Link>
                          {o.so_number && <div className="text-[11px] text-gray-400">SO {o.so_number}</div>}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{o.customer_name}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {[o.destination, o.kota].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">{o.total_items}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{fmtNum(o.total_qty, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}