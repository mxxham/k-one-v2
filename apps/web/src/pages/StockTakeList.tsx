import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtNum, todayISO } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { Field, TextInput, TextArea } from '@/components/Field';

interface StockTakeRow {
  id: number;
  take_number?: string;
  take_date?: string;
  status?: string;
  notes?: string;
  created_by_name?: string;
  total_items?: number;
  plus_count?: number;
  minus_count?: number;
  clear_count?: number;
}

interface TakeStats {
  total?: number;
  this_month?: number;
  this_year?: number;
  avg_accuracy?: number;
}

export default function StockTakeList() {
  const { canWrite } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [rows, setRows] = useState<StockTakeRow[]>([]);
  const [stats, setStats] = useState<TakeStats>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [takeDate, setTakeDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [scope, setScope] = useState<'full' | 'locations'>('full');
  const [locations, setLocations] = useState<string[]>([]);
  const [locked, setLocked] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        api('stocktake', 'list'),
        api('stocktake', 'stats'),
      ]);
      setRows(listRes.rows || []);
      setStats(statsRes.stats || {});
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data stock take');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = async () => {
    setTakeDate(todayISO());
    setNotes('');
    setScope('full');
    setSelected([]);
    setCreateOpen(true);
    try {
      const res = await api('stocktake', 'get_scope_locations');
      setLocations(res.locations || []);
      setLocked(res.locked || []);
    } catch {
      setLocations([]);
      setLocked([]);
    }
  };

  const toggleLocation = (loc: string) => {
    setSelected((prev) => (prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]));
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!takeDate) {
      toast('error', 'Tanggal wajib diisi');
      return;
    }
    if (scope === 'locations' && selected.length === 0) {
      toast('error', 'Pilih minimal satu lokasi');
      return;
    }
    setSaving(true);
    try {
      const res = await api('stocktake', 'create', {
        body: {
          take_date: takeDate,
          notes: notes || undefined,
          scope_locations: scope === 'locations' ? selected : null,
          auto_load: scope === 'full',
        },
      });
      toast('success', 'Stock take berhasil dibuat');
      setCreateOpen(false);
      navigate(`/stocktake/${res.id}`);
    } catch (err: any) {
      toast('error', err.message || 'Gagal membuat stock take');
    } finally {
      setSaving(false);
    }
  };

  const kpis: { label: string; value: string }[] = [
    { label: 'Total', value: fmtNum(stats.total, 0) },
    { label: 'Bulan Ini', value: fmtNum(stats.this_month, 0) },
    { label: 'Tahun Ini', value: fmtNum(stats.this_year, 0) },
    { label: 'Avg Accuracy', value: `${fmtNum(stats.avg_accuracy, 1)}%` },
  ];

  return (
    <div>
      <PageHeader
        title="Stock Take"
        subtitle="Perhitungan fisik stok gudang"
        actions={
          <>
            {canWrite && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
              >
                <Plus className="w-4 h-4" /> New Stock Take
              </button>
            )}
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">{k.label}</div>
            <div className="text-2xl font-extrabold text-brand-700">{k.value}</div>
          </div>
        ))}
      </div>

      <Card>
        {loading ? (
          <Spinner label="Loading stock take…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Belum ada stock take" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-brand-50">
                  <tr>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Take No</th>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Take Date</th>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Status</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Items</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Plus</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Minus</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Clear</th>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Created By</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-brand-50 transition-colors">
                      <td className="px-4 py-3 border-t border-gray-100">
                        <Link to={`/stocktake/${row.id}`} className="text-sm font-semibold text-brand-600 hover:text-brand-800 hover:underline">
                          {row.take_number || `#${row.id}`}
                        </Link>
                      </td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">{fmtDate(row.take_date)}</td>
                      <td className="px-4 py-3 border-t border-gray-100">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700 text-right">{fmtNum(row.total_items, 0)}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-emerald-600 text-right font-semibold">{fmtNum(row.plus_count, 0)}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-red-600 text-right font-semibold">{fmtNum(row.minus_count, 0)}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700 text-right">{fmtNum(row.clear_count, 0)}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">{row.created_by_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Stock Take" size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Take Date" required>
            <TextInput type="date" value={takeDate} onChange={(e) => setTakeDate(e.target.value)} />
          </Field>
          <Field label="Notes">
            <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan stock take (opsional)" />
          </Field>

          <Field label="Scope">
            <div className="space-y-3">
              <label className="flex items-start gap-2.5 p-3 rounded-lg border-[1.5px] border-gray-200 cursor-pointer hover:border-brand-400">
                <input type="radio" checked={scope === 'full'} onChange={() => setScope('full')} className="mt-0.5 accent-brand-600" />
                <div>
                  <div className="text-sm font-semibold text-gray-800">Full warehouse (auto-load)</div>
                  <div className="text-xs text-gray-400">Semua stok di gudang dimuat otomatis.</div>
                </div>
              </label>
              <label className="flex items-start gap-2.5 p-3 rounded-lg border-[1.5px] border-gray-200 cursor-pointer hover:border-brand-400">
                <input type="radio" checked={scope === 'locations'} onChange={() => setScope('locations')} className="mt-0.5 accent-brand-600" />
                <div>
                  <div className="text-sm font-semibold text-gray-800">By locations</div>
                  <div className="text-xs text-gray-400">Pilih lokasi yang akan dihitung.</div>
                </div>
              </label>

              {scope === 'locations' && (
                <div className="mt-2 border border-gray-200 rounded-lg max-h-52 overflow-y-auto p-2 grid grid-cols-2 gap-1">
                  {locations.length === 0 && <div className="col-span-2 text-sm text-gray-400 px-2 py-4 text-center">Tidak ada lokasi</div>}
                  {locations.map((loc) => {
                    const isLocked = locked.includes(loc);
                    const checked = selected.includes(loc);
                    return (
                      <label
                        key={loc}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer ${
                          checked ? 'bg-brand-50 text-brand-800' : 'text-gray-700 hover:bg-gray-50'
                        } ${isLocked ? 'opacity-50 pointer-events-none' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isLocked}
                          onChange={() => toggleLocation(loc)}
                          className="accent-brand-600"
                        />
                        <span className="truncate">{loc}</span>
                        {isLocked && <span className="text-[10px] text-gray-400 ml-auto">locked</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </Field>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-60"
            >
              <ClipboardCheck className="w-4 h-4" /> {saving ? 'Membuat…' : 'Buat Stock Take'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
