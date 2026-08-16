import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Pencil, MapPin, Search, Map, Boxes, List, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import Spinner from '@/components/Spinner';
import Modal from '@/components/Modal';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, Select, Grid } from '@/components/Field';
import RackViews from '@/components/RackViews';
import LocationLabels, { LocationLabelRow } from '@/components/LocationLabels';

interface LocationRow {
  id: number;
  location_code: string;
  aisle: string | null;
  rack: string | null;
  row_name: string | null;
  position: string | null;
  zone: string | null;
  is_active: number;
  availability: string;
  occupied_pallets: number;
  current_qty: number;
  current_batch: string | null;
}

interface ZoneSummary {
  zone: string | null;
  total: number;
  active: number;
}

const ZONE_OPTIONS = ['Bulk', 'Carton', 'Pallet', 'Rack', 'Pail', 'Special', 'Quarantine', 'General'];

const emptyForm = {
  location_code: '',
  aisle: '',
  rack: '',
  row_name: '',
  position: '',
  zone: 'Bulk',
};

export default function LocationsPage() {
  const toast = useToast();
  const { canWrite, canAdmin } = useAuth();

  const [rows, setRows] = useState<LocationRow[]>([]);
  const [zones, setZones] = useState<ZoneSummary[]>([]);
  const [zoneFilter, setZoneFilter] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [binLabels, setBinLabels] = useState<LocationLabelRow[]>([]);
  const [labelsBusy, setLabelsBusy] = useState(false);

  const [tab, setTab] = useState<'list' | 'rackmap' | 'rack3d'>('list');

  const TABS = [
    { key: 'list' as const, label: 'Locations List', icon: List },
    { key: 'rackmap' as const, label: 'Rack Map (2D)', icon: Map },
    { key: 'rack3d' as const, label: 'Rack View (3D)', icon: Boxes },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('locations', 'list', {
        params: { zone: zoneFilter || undefined, available_only: availableOnly ? '1' : undefined },
      });
      setRows(res.rows || []);
      setZones(res.zones || []);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data lokasi');
    } finally {
      setLoading(false);
    }
  }, [zoneFilter, availableOnly, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (l: LocationRow) => {
    setEditing(l);
    setForm({
      location_code: l.location_code || '',
      aisle: l.aisle || '',
      rack: l.rack || '',
      row_name: l.row_name || '',
      position: l.position || '',
      zone: l.zone || 'Bulk',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.location_code.trim()) {
      toast('error', 'Kode lokasi wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        location_code: form.location_code.trim().toUpperCase(),
        aisle: form.aisle.trim().toUpperCase() || undefined,
        rack: form.rack.trim() || undefined,
        row_name: form.row_name.trim().toUpperCase() || undefined,
        position: form.position.trim() || undefined,
        zone: form.zone || undefined,
      };
      if (editing) {
        await api('locations', 'update', { body: { id: editing.id, ...payload } });
        toast('success', 'Lokasi berhasil diperbarui');
      } else {
        await api('locations', 'create', { body: payload });
        toast('success', 'Lokasi berhasil ditambahkan');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan lokasi');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (l: LocationRow) => {
    try {
      await api('locations', 'update', {
        body: {
          id: l.id,
          location_code: l.location_code,
          aisle: l.aisle || undefined,
          rack: l.rack || undefined,
          row_name: l.row_name || undefined,
          position: l.position || undefined,
          zone: l.zone || undefined,
          is_active: Number(l.is_active) === 1 ? 0 : 1,
        },
      });
      toast('success', Number(l.is_active) === 1 ? 'Lokasi dinonaktifkan' : 'Lokasi diaktifkan');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal mengubah status lokasi');
    }
  };

  const handleDelete = async (l: LocationRow) => {
    try {
      await api('locations', 'delete', { body: { id: l.id } });
      toast('success', 'Lokasi dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus lokasi');
    }
  };

  const printBinLabels = async () => {
    try {
      setLabelsBusy(true);
      const res: any = await api('locations', 'print_labels', {
        params: { zone: zoneFilter || undefined },
      });
      setBinLabels(res.rows ?? []);
      setLabelModalOpen(true);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat label lokasi');
    } finally {
      setLabelsBusy(false);
    }
  };

  const set = (k: keyof typeof emptyForm) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const zoneStats = zones.map((z) => ({
    label: z.zone || '—',
    total: Number(z.total) || 0,
    active: Number(z.active) || 0,
  }));

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle="Master data lokasi penyimpanan"
        actions={
          <>
            {canWrite && tab === 'list' && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
              >
                <Plus className="w-4 h-4" /> New Location
              </button>
            )}
            <button
              onClick={() => load()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </>
        }
      />

      <div className="flex gap-2 mb-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition ${
              tab === t.key
                ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-brand-50'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'list' && <RackViews tab={tab} />}

      {tab === 'list' && (
      <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {zoneStats.map((z) => (
          <div key={z.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">{z.label}</div>
            <div className="flex items-end justify-between">
              <div className="text-2xl font-extrabold text-brand-700">{fmtNum(z.total, 0)}</div>
              <span className="text-[11px] text-emerald-600 font-semibold">{fmtNum(z.active, 0)} aktif</span>
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div className="mb-4 flex items-end gap-3 flex-wrap">
          <div className="w-56">
            <Field label="Filter Zone">
              <Select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                <option value="">Semua Zone</option>
                {ZONE_OPTIONS.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 pb-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(e) => setAvailableOnly(e.target.checked)}
              className="accent-brand-600"
            />
            <span className="text-sm text-gray-600 font-medium">Hanya lokasi kosong</span>
          </label>
          <button
            onClick={() => load()}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 inline-flex items-center gap-2"
          >
            <Search className="w-4 h-4" /> Terapkan
          </button>
          <button
            onClick={printBinLabels}
            disabled={labelsBusy}
            className="px-4 py-2 rounded-lg bg-white text-gray-700 text-sm font-semibold hover:bg-gray-100 border border-gray-300 inline-flex items-center gap-2 disabled:opacity-50"
            title="Cetak label barcode untuk semua bin pada filter zone saat ini (rack walk)"
          >
            <Printer className="w-4 h-4" /> {labelsBusy ? 'Memuat…' : 'Cetak Label Lokasi'}
          </button>
        </div>

        {loading ? (
          <Spinner label="Memuat lokasi…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Tidak ada data lokasi" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[880px]">
              <thead>
                <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 text-left font-bold">Kode</th>
                  <th className="px-3 py-2.5 text-left font-bold">Aisle</th>
                  <th className="px-3 py-2.5 text-left font-bold">Rack</th>
                  <th className="px-3 py-2.5 text-left font-bold">Row</th>
                  <th className="px-3 py-2.5 text-left font-bold">Pos</th>
                  <th className="px-3 py-2.5 text-left font-bold">Zone</th>
                  <th className="px-3 py-2.5 text-center font-bold">Status</th>
                  <th className="px-3 py-2.5 text-right font-bold">Qty</th>
                  <th className="px-3 py-2.5 text-right font-bold">Pallet</th>
                  <th className="px-3 py-2.5 text-left font-bold">Batch</th>
                  <th className="px-3 py-2.5 text-center font-bold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((l) => (
                  <tr key={l.id} className="hover:bg-brand-50/50">
                    <td className="px-3 py-2.5 font-semibold text-brand-700 font-mono">{l.location_code}</td>
                    <td className="px-3 py-2.5 text-gray-600">{l.aisle || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{l.aisle || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{l.row_name || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{l.position || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-[11px] font-bold border border-brand-100">
                        {l.zone || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {(l.availability || 'Available') === 'Occupied' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-orange-50 text-orange-700 border-orange-300">
                          Occupied
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-300">
                          Available
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold">{fmtNum(l.current_qty, 0)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{fmtNum(l.occupied_pallets, 0)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{l.current_batch || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        {canWrite && (
                          <button
                            onClick={() => openEdit(l)}
                            title="Edit"
                            className="p-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 border border-brand-100"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canWrite && (
                          <button
                            onClick={() => toggleActive(l)}
                            title={Number(l.is_active) === 1 ? 'Nonaktifkan' : 'Aktifkan'}
                            className={`p-1.5 rounded-lg border ${
                              Number(l.is_active) === 1
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100'
                                : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                            }`}
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canAdmin && (
                          <ConfirmButton label="Hapus" onConfirm={() => handleDelete(l)} />
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
      </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Location' : 'New Location'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Kode Lokasi" required>
            <TextInput value={form.location_code} onChange={set('location_code')} placeholder="Contoh: A-01-01-01" />
          </Field>
          <Grid cols={2}>
            <Field label="Aisle">
              <TextInput value={form.aisle} onChange={set('aisle')} placeholder="Aisle" />
            </Field>
            <Field label="Rack">
              <TextInput value={form.rack} onChange={set('rack')} placeholder="Rack" />
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Row Name">
              <TextInput value={form.row_name} onChange={set('row_name')} placeholder="Row" />
            </Field>
            <Field label="Position">
              <TextInput value={form.position} onChange={set('position')} placeholder="Posisi" />
            </Field>
          </Grid>
          <Field label="Zone">
            <Select value={form.zone} onChange={set('zone')}>
              {ZONE_OPTIONS.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </Select>
          </Field>
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
              <MapPin className="w-4 h-4" /> {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Tambah Lokasi'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={labelModalOpen} onClose={() => setLabelModalOpen(false)} title="Cetak Label Lokasi (rack walk)" size="lg">
        <LocationLabels labels={binLabels} onClose={() => setLabelModalOpen(false)} />
      </Modal>
    </div>
  );
}
