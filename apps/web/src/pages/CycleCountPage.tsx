import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, CalendarCheck, Play, Pencil, Trash2, CalendarClock } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtNum, todayISO } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, Select } from '@/components/Field';

interface ScheduleRow {
  id: number;
  schedule_name: string;
  frequency: string;
  scope_type: string;
  scope_locations: string | null;
  velocity_class: string | null;
  next_run_date: string;
  is_active: boolean;
  created_by_name?: string;
  is_due: boolean;
  total_generated?: number;
}

const FREQUENCIES = ['weekly', 'monthly', 'quarterly'];
const SCOPE_TYPES = ['full', 'location', 'velocity'];

function scopeLabel(r: { scope_type: string; velocity_class: string | null }): string {
  if (r.scope_type === 'velocity') return `Velocity ${r.velocity_class ?? ''}`.trim();
  if (r.scope_type === 'location') return 'Lokasi';
  return 'Full';
}

export default function CycleCountPage() {
  const { canAdmin, canWrite } = useAuth();
  const toast = useToast();

  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [scopeType, setScopeType] = useState('full');
  const [locations, setLocations] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [velocityClass, setVelocityClass] = useState('A');
  const [nextRun, setNextRun] = useState(todayISO());
  const [isActive, setIsActive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('cyclecount', 'list', {});
      setRows(res.rows || []);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat jadwal cycle count');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const fetchLocations = async () => {
    try {
      const res = await api('stocktake', 'get_scope_locations', {});
      setLocations(res.locations || []);
    } catch {
      setLocations([]);
    }
  };

  const openCreate = async () => {
    setEditing(null);
    setName('');
    setFrequency('monthly');
    setScopeType('full');
    setSelected([]);
    setVelocityClass('A');
    setNextRun(todayISO());
    setIsActive(true);
    setModalOpen(true);
    await fetchLocations();
  };

  const openEdit = async (r: ScheduleRow) => {
    setEditing(r);
    setName(r.schedule_name);
    setFrequency(r.frequency);
    setScopeType(r.scope_type);
    setSelected(r.scope_locations ? (JSON.parse(r.scope_locations) as string[]) : []);
    setVelocityClass(r.velocity_class || 'A');
    setNextRun(r.next_run_date);
    setIsActive(r.is_active);
    setModalOpen(true);
    await fetchLocations();
  };

  const toggleLocation = (loc: string) => {
    setSelected((prev) => (prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]));
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast('error', 'Nama jadwal wajib diisi');
      return;
    }
    if (scopeType === 'location' && selected.length === 0) {
      toast('error', 'Pilih minimal satu lokasi');
      return;
    }
    if (scopeType === 'velocity' && !velocityClass) {
      toast('error', 'Pilih velocity class');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api('cyclecount', 'update', {
          body: {
            id: editing.id,
            schedule_name: name,
            frequency,
            scope_type: scopeType,
            scope_locations: scopeType === 'location' ? selected : null,
            velocity_class: scopeType === 'velocity' ? velocityClass : null,
            next_run_date: nextRun,
            is_active: isActive,
          },
        });
        toast('success', 'Jadwal berhasil diperbarui');
      } else {
        await api('cyclecount', 'create', {
          body: {
            schedule_name: name,
            frequency,
            scope_type: scopeType,
            scope_locations: scopeType === 'location' ? selected : null,
            velocity_class: scopeType === 'velocity' ? velocityClass : null,
            next_run_date: nextRun,
            is_active: isActive,
          },
        });
        toast('success', 'Jadwal cycle count dibuat');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan jadwal');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api('cyclecount', 'delete', { body: { id } });
      toast('success', 'Jadwal dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus jadwal');
    }
  };

  const handleRunDue = async () => {
    setRunning(true);
    try {
      const res = await api('cyclecount', 'run_due', {});
      const n = res.count ?? 0;
      toast('success', n > 0 ? `Run due: ${n} stock take dibuat (${(res.generated || []).map((g: any) => g.take_number).join(', ')})` : 'Tidak ada jadwal yang jatuh tempo');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menjalankan jadwal');
    } finally {
      setRunning(false);
    }
  };

  const handleRunNow = async (id: number) => {
    setRunning(true);
    try {
      const res = await api('cyclecount', 'run_now', { body: { id } });
      toast('success', `Run now: stock take ${res.generated?.[0]?.take_number ?? ''} dibuat`);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal run now');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Cycle Count"
        subtitle="Jadwal perhitungan fisik stok berulang"
        actions={
          <>
            {canAdmin && (
              <button
                onClick={handleRunDue}
                disabled={running}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60"
              >
                <Play className="w-4 h-4" /> {running ? 'Menjalankan…' : 'Run Due Schedules'}
              </button>
            )}
            {canWrite && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
              >
                <Plus className="w-4 h-4" /> New Schedule
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

      <Card>
        {loading ? (
          <Spinner label="Loading schedules…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Belum ada jadwal cycle count" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-brand-50">
                <tr className="text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 font-bold">Nama Jadwal</th>
                  <th className="px-3 py-2.5 font-bold">Frequency</th>
                  <th className="px-3 py-2.5 font-bold">Scope</th>
                  <th className="px-3 py-2.5 font-bold">Next Run</th>
                  <th className="px-3 py-2.5 text-center font-bold">Due</th>
                  <th className="px-3 py-2.5 font-bold">Status</th>
                  <th className="px-3 py-2.5 text-right font-bold">Generated</th>
                  <th className="px-3 py-2.5 font-bold">Dibuat oleh</th>
                  <th className="px-3 py-2.5 text-right font-bold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-brand-50/50">
                    <td className="px-3 py-2.5 font-semibold text-brand-800">{r.schedule_name}</td>
                    <td className="px-3 py-2.5 text-gray-600 capitalize">{r.frequency}</td>
                    <td className="px-3 py-2.5">
                      {scopeLabel(r)}
                      {r.scope_type === 'velocity' && r.velocity_class && (
                        <span className="ml-1.5 inline-block"><StatusBadge status={r.velocity_class} /></span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 font-mono text-xs">{fmtDate(r.next_run_date)}</td>
                    <td className="px-3 py-2.5 text-center">
                      {r.is_due ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                          <CalendarClock className="w-3 h-3" /> Due
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.is_active ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{fmtNum(r.total_generated, 0)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.created_by_name || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {canAdmin && (
                          <button
                            onClick={() => handleRunNow(r.id)}
                            disabled={running}
                            title="Run Now"
                            className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canWrite && (
                          <button
                            onClick={() => openEdit(r)}
                            title="Edit"
                            className="p-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canWrite && (
                          <ConfirmButton
                            label="Hapus"
                            confirmText="Hapus jadwal cycle count ini?"
                            onConfirm={() => handleDelete(r.id)}
                            className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </ConfirmButton>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Jadwal Cycle Count' : 'New Jadwal Cycle Count'}>
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Nama Jadwal" required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Monthly Full Count" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Frequency" required>
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Scope Type" required>
              <Select value={scopeType} onChange={(e) => setScopeType(e.target.value)}>
                {SCOPE_TYPES.map((s) => (
                  <option key={s} value={s}>{s === 'velocity' ? 'Velocity Class' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </Select>
            </Field>
          </div>

          {scopeType === 'location' && (
            <div className="bg-brand-50/50 rounded-lg border border-brand-100 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-brand-700 mb-2">Pilih Lokasi</div>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {locations.length === 0 && <span className="text-xs text-gray-400">Tidak ada lokasi tersedia</span>}
                {locations.map((loc) => {
                  const on = selected.includes(loc);
                  return (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => toggleLocation(loc)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                        on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-brand-50'
                      }`}
                    >
                      {loc}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {scopeType === 'velocity' && (
            <Field label="Velocity Class" required hint="Hanya produk dengan class ini yang dihitung (S26 ABC)">
              <Select value={velocityClass} onChange={(e) => setVelocityClass(e.target.value)}>
                <option value="A">A — high velocity</option>
                <option value="B">B — medium</option>
                <option value="C">C — low velocity</option>
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Next Run Date" required>
              <TextInput type="date" value={nextRun} onChange={(e) => setNextRun(e.target.value)} />
            </Field>
            <Field label="Status">
              <Select value={isActive ? '1' : '0'} onChange={(e) => setIsActive(e.target.value === '1')}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </Select>
            </Field>
          </div>

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
              <CalendarCheck className="w-4 h-4" /> {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Buat Jadwal'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}