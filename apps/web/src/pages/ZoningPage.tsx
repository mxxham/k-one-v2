import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Pencil, Layers, FlaskConical, Box, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import Spinner from '@/components/Spinner';
import Modal from '@/components/Modal';
import { Field, TextInput, Select, Grid } from '@/components/Field';

const LEVELS = ['A', 'B', 'C', 'D', 'E'];

const UOM_OPTIONS = ['Drum', 'Carton', 'Pail', 'EA', 'Bags'];
const ZONE_TYPES = ['PICK_FAST', 'RESERVE', 'BULK', 'QUARANTINE', 'STAGING', 'UNALLOCATED'];

interface UomLimitRow {
  uom_type: string;
  min_level: string;
  max_level: string;
  allow_pick_face: number;
  max_weight_kg: number | null;
  max_height_cm: number | null;
  requires_equipment: number;
}

interface ProductRuleRow {
  product_id: number;
  product_code: string;
  product_name: string;
  uom_type: string;
  uom_per_pallet: number;
  preferred_zone_code: string;
  max_level: string | null;
  allow_pick_face: number | null;
  full_pallet_to_pick: number;
  min_pick_face_qty: number;
  max_pick_face_qty: number;
  consolidate: number;
}

interface ZoneRow {
  id: number;
  zone_code: string;
  zone_name: string;
  zone_type: string;
  priority: number;
  is_active: number;
  location_count: number;
}

interface ProductOption {
  id: number;
  product_code: string;
  product_name: string;
  uom_type: string;
}

const emptyUom = { uom_type: 'Drum', min_level: 'A', max_level: 'E', allow_pick_face: 1, max_weight_kg: '', max_height_cm: '', requires_equipment: 0 };
const emptyZone = { zone_code: '', zone_name: '', zone_type: 'RESERVE', priority: 10, is_active: 1 };
const emptyRule = {
  product_id: '',
  preferred_zone_code: 'RESERVE',
  max_level: '',
  allow_pick_face: '',
  full_pallet_to_pick: 0,
  min_pick_face_qty: 0,
  max_pick_face_qty: 0,
  consolidate: 1,
};

export default function ZoningPage() {
  const toast = useToast();
  const { canWrite } = useAuth();

  const [tab, setTab] = useState<'uom' | 'product' | 'zone'>('uom');

  const [uomLimits, setUomLimits] = useState<UomLimitRow[]>([]);
  const [productRules, setProductRules] = useState<ProductRuleRow[]>([]);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);

  // modals
  const [uomModal, setUomModal] = useState(false);
  const [uomForm, setUomForm] = useState(emptyUom);
  const [zoneModal, setZoneModal] = useState(false);
  const [zoneForm, setZoneForm] = useState(emptyZone);
  const [editingZone, setEditingZone] = useState<ZoneRow | null>(null);
  const [ruleModal, setRuleModal] = useState(false);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [editingRule, setEditingRule] = useState<ProductRuleRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uomRes, ruleRes, zoneRes, prodRes] = await Promise.all([
        api('putaway', 'uom_limits'),
        api('putaway', 'product_rules'),
        api('putaway', 'zones'),
        api('products', 'all'),
      ]);
      setUomLimits(uomRes.rows || []);
      setProductRules(ruleRes.rows || []);
      setZones(zoneRes.rows || []);
      setProducts(prodRes.rows || []);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data zoning');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // ---------------------------------------------------------------- UOM limits
  const openUomEdit = (row?: UomLimitRow) => {
    setUomForm(
      row
        ? {
            uom_type: row.uom_type,
            min_level: row.min_level || 'A',
            max_level: row.max_level || 'E',
            allow_pick_face: Number(row.allow_pick_face),
            max_weight_kg: row.max_weight_kg != null ? String(row.max_weight_kg) : '',
            max_height_cm: row.max_height_cm != null ? String(row.max_height_cm) : '',
            requires_equipment: Number(row.requires_equipment),
          }
        : emptyUom,
    );
    setUomModal(true);
  };

  const saveUom = async (e: FormEvent) => {
    e.preventDefault();
    if (LEVELS.indexOf(uomForm.min_level) > LEVELS.indexOf(uomForm.max_level)) {
      toast('error', 'min_level tidak boleh lebih tinggi dari max_level');
      return;
    }
    setSaving(true);
    try {
      await api('putaway', 'save_uom_limit', {
        body: {
          ...uomForm,
          max_weight_kg: uomForm.max_weight_kg === '' ? undefined : uomForm.max_weight_kg,
          max_height_cm: uomForm.max_height_cm === '' ? undefined : uomForm.max_height_cm,
        },
      });
      toast('success', 'Batas level UOM tersimpan');
      setUomModal(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- Product rules
  const openRuleCreate = () => {
    setEditingRule(null);
    setRuleForm(emptyRule);
    setRuleModal(true);
  };

  const openRuleEdit = (r: ProductRuleRow) => {
    setEditingRule(r);
    setRuleForm({
      product_id: String(r.product_id),
      preferred_zone_code: r.preferred_zone_code || 'RESERVE',
      max_level: r.max_level || '',
      allow_pick_face: r.allow_pick_face == null ? '' : String(r.allow_pick_face),
      full_pallet_to_pick: Number(r.full_pallet_to_pick),
      min_pick_face_qty: Number(r.min_pick_face_qty),
      max_pick_face_qty: Number(r.max_pick_face_qty),
      consolidate: Number(r.consolidate),
    });
    setRuleModal(true);
  };

  const saveRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!ruleForm.product_id) {
      toast('error', 'Pilih produk');
      return;
    }
    setSaving(true);
    try {
      await api('putaway', 'save_product_rule', {
        body: {
          ...ruleForm,
          product_id: Number(ruleForm.product_id),
          allow_pick_face: ruleForm.allow_pick_face === '' ? undefined : Number(ruleForm.allow_pick_face),
          max_level: ruleForm.max_level === '' ? undefined : ruleForm.max_level,
        },
      });
      toast('success', 'Aturan putaway produk tersimpan');
      setRuleModal(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (r: ProductRuleRow) => {
    try {
      await api('putaway', 'delete_product_rule', { body: { product_id: r.product_id } });
      toast('success', 'Aturan produk dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus');
    }
  };

  // ---------------------------------------------------------------- Zones
  const openZoneEdit = (z?: ZoneRow) => {
    setEditingZone(z || null);
    setZoneForm(
      z
        ? {
            zone_code: z.zone_code,
            zone_name: z.zone_name,
            zone_type: z.zone_type,
            priority: z.priority,
            is_active: z.is_active,
          }
        : emptyZone,
    );
    setZoneModal(true);
  };

  const saveZone = async (e: FormEvent) => {
    e.preventDefault();
    if (!zoneForm.zone_code.trim()) {
      toast('error', 'zone_code wajib diisi');
      return;
    }
    setSaving(true);
    try {
      await api('putaway', 'save_zone', {
        body: { id: editingZone?.id, ...zoneForm, zone_code: zoneForm.zone_code.trim().toUpperCase() },
      });
      toast('success', 'Zone tersimpan');
      setZoneModal(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const deleteZone = async (z: ZoneRow) => {
    try {
      await api('putaway', 'delete_zone', { body: { id: z.id } });
      toast('success', 'Zone dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus');
    }
  };

  const TABS = [
    { key: 'uom' as const, label: 'UOM Level Limits', icon: FlaskConical },
    { key: 'product' as const, label: 'Produk & Putaway Rules', icon: Box },
    { key: 'zone' as const, label: 'Zones', icon: Layers },
  ];

  return (
    <div>
      <PageHeader
        title="Zoning"
        subtitle="Konfigurasi level penyimpanan, batas UOM, dan aturan putaway"
        actions={
          <>
            {canWrite && tab === 'product' && (
              <button
                onClick={openRuleCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
              >
                <Plus className="w-4 h-4" /> New Rule
              </button>
            )}
            {canWrite && tab === 'zone' && (
              <button
                onClick={() => openZoneEdit()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
              >
                <Plus className="w-4 h-4" /> New Zone
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

      {loading ? (
        <Spinner label="Memuat data zoning…" />
      ) : (
        <>
          {tab === 'uom' && (
            <Card
              title="Batas Fisik UOM per Level"
              actions={
                canWrite ? (
                  <button onClick={() => openUomEdit()} className="text-xs font-bold text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Tambah
                  </button>
                ) : undefined
              }
            >
              {uomLimits.length === 0 ? (
                <EmptyState message="Belum ada data batas UOM" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[820px]">
                    <thead>
                      <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                        <th className="px-3 py-2.5 text-left font-bold">UOM</th>
                        <th className="px-3 py-2.5 text-center font-bold">Min Level</th>
                        <th className="px-3 py-2.5 text-center font-bold">Max Level</th>
                        <th className="px-3 py-2.5 text-center font-bold">Pick Face</th>
                        <th className="px-3 py-2.5 text-center font-bold">Max Berat (kg)</th>
                        <th className="px-3 py-2.5 text-center font-bold">Max Tinggi (cm)</th>
                        <th className="px-3 py-2.5 text-center font-bold">Heavy Equipment</th>
                        <th className="px-3 py-2.5 text-center font-bold">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {uomLimits.map((u) => (
                        <tr key={u.uom_type} className="hover:bg-brand-50/50">
                          <td className="px-3 py-2.5 font-semibold text-brand-700">{u.uom_type}</td>
                          <td className="px-3 py-2.5 text-center font-bold">{u.min_level}</td>
                          <td className="px-3 py-2.5 text-center font-bold">{u.max_level}</td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge ok={Number(u.allow_pick_face) === 1}>{Number(u.allow_pick_face) === 1 ? 'Ya' : 'Tidak'}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{u.max_weight_kg != null ? fmtNum(u.max_weight_kg) : '—'}</td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{u.max_height_cm != null ? fmtNum(u.max_height_cm) : '—'}</td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge ok={Number(u.requires_equipment) === 1}>{Number(u.requires_equipment) === 1 ? 'Ya' : 'Tidak'}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {canWrite && (
                              <button
                                onClick={() => openUomEdit(u)}
                                title="Edit"
                                className="p-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 border border-brand-100"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'product' && (
            <Card title="Aturan Putaway per Produk">
              {productRules.length === 0 ? (
                <EmptyState message="Belum ada aturan produk — klik New Rule untuk menambah" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[1000px]">
                    <thead>
                      <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                        <th className="px-3 py-2.5 text-left font-bold">Produk</th>
                        <th className="px-3 py-2.5 text-center font-bold">UOM</th>
                        <th className="px-3 py-2.5 text-center font-bold">Zone</th>
                        <th className="px-3 py-2.5 text-center font-bold">Max Level</th>
                        <th className="px-3 py-2.5 text-center font-bold">Pick Face</th>
                        <th className="px-3 py-2.5 text-center font-bold">Full→Pick</th>
                        <th className="px-3 py-2.5 text-center font-bold">Min PF Qty</th>
                        <th className="px-3 py-2.5 text-center font-bold">Max PF Qty</th>
                        <th className="px-3 py-2.5 text-center font-bold">Konsolidasi</th>
                        <th className="px-3 py-2.5 text-center font-bold">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {productRules.map((r) => (
                        <tr key={r.product_id} className="hover:bg-brand-50/50">
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-brand-700">{r.product_code}</div>
                            <div className="text-[11px] text-gray-400">{r.product_name}</div>
                          </td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{r.uom_type}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-flex px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-[11px] font-bold border border-brand-100">
                              {r.preferred_zone_code || 'RESERVE'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold">{r.max_level || '—'}</td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge ok={Number(r.allow_pick_face) === 1}>{r.allow_pick_face == null ? 'Default' : Number(r.allow_pick_face) === 1 ? 'Ya' : 'Tidak'}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge ok={Number(r.full_pallet_to_pick) === 1}>{Number(r.full_pallet_to_pick) === 1 ? 'Ya' : 'Tidak'}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{fmtNum(r.min_pick_face_qty, 0)}</td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{fmtNum(r.max_pick_face_qty, 0)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge ok={Number(r.consolidate) === 1}>{Number(r.consolidate) === 1 ? 'Ya' : 'Tidak'}</Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-center gap-1.5">
                              {canWrite && (
                                <button
                                  onClick={() => openRuleEdit(r)}
                                  title="Edit"
                                  className="p-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 border border-brand-100"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canWrite && (
                                <button
                                  onClick={() => deleteRule(r)}
                                  title="Hapus"
                                  className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-100"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
          )}

          {tab === 'zone' && (
            <Card title="Zones">
              {zones.length === 0 ? (
                <EmptyState message="Belum ada zone" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead>
                      <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                        <th className="px-3 py-2.5 text-left font-bold">Kode</th>
                        <th className="px-3 py-2.5 text-left font-bold">Nama</th>
                        <th className="px-3 py-2.5 text-center font-bold">Tipe</th>
                        <th className="px-3 py-2.5 text-center font-bold">Prioritas</th>
                        <th className="px-3 py-2.5 text-center font-bold">Lokasi</th>
                        <th className="px-3 py-2.5 text-center font-bold">Aktif</th>
                        <th className="px-3 py-2.5 text-center font-bold">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {zones.map((z) => (
                        <tr key={z.id} className="hover:bg-brand-50/50">
                          <td className="px-3 py-2.5 font-semibold text-brand-700">{z.zone_code}</td>
                          <td className="px-3 py-2.5 text-gray-600">{z.zone_name}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-flex px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-[11px] font-bold border border-brand-100">
                              {z.zone_type}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold">{z.priority}</td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{fmtNum(z.location_count, 0)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge ok={Number(z.is_active) === 1}>{Number(z.is_active) === 1 ? 'Aktif' : 'Nonaktif'}</Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-center gap-1.5">
                              {canWrite && (
                                <button
                                  onClick={() => openZoneEdit(z)}
                                  title="Edit"
                                  className="p-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 border border-brand-100"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canWrite && (
                                <button
                                  onClick={() => deleteZone(z)}
                                  title="Hapus"
                                  className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-100"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
          )}
        </>
      )}

      {/* UOM limit modal */}
      <Modal open={uomModal} onClose={() => setUomModal(false)} title="Batas Fisik UOM" size="md">
        <form onSubmit={saveUom} className="space-y-4">
          <Field label="UOM Type" required>
            <Select value={uomForm.uom_type} onChange={(e) => setUomForm((f) => ({ ...f, uom_type: e.target.value }))}>
              {UOM_OPTIONS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Select>
          </Field>
          <Grid cols={2}>
            <Field label="Min Level">
              <Select value={uomForm.min_level} onChange={(e) => setUomForm((f) => ({ ...f, min_level: e.target.value }))}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="Max Level" hint="Level tertinggi yang boleh ditempati UOM ini">
              <Select value={uomForm.max_level} onChange={(e) => setUomForm((f) => ({ ...f, max_level: e.target.value }))}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Allow Pick Face (Level A)">
              <Select value={uomForm.allow_pick_face} onChange={(e) => setUomForm((f) => ({ ...f, allow_pick_face: Number(e.target.value) }))}>
                <option value={1}>Ya</option>
                <option value={0}>Tidak</option>
              </Select>
            </Field>
            <Field label="Requires Heavy Equipment">
              <Select value={uomForm.requires_equipment} onChange={(e) => setUomForm((f) => ({ ...f, requires_equipment: Number(e.target.value) }))}>
                <option value={1}>Ya</option>
                <option value={0}>Tidak</option>
              </Select>
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Max Berat / Pallet (kg)">
              <TextInput type="number" value={uomForm.max_weight_kg} onChange={(e) => setUomForm((f) => ({ ...f, max_weight_kg: e.target.value }))} placeholder="cth: 1000" />
            </Field>
            <Field label="Max Tinggi / Pallet (cm)">
              <TextInput type="number" value={uomForm.max_height_cm} onChange={(e) => setUomForm((f) => ({ ...f, max_height_cm: e.target.value }))} placeholder="cth: 200" />
            </Field>
          </Grid>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setUomModal(false)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200">
              Batal
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-60">
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Product rule modal */}
      <Modal open={ruleModal} onClose={() => setRuleModal(false)} title={editingRule ? 'Edit Aturan Produk' : 'New Putaway Rule'} size="lg">
        <form onSubmit={saveRule} className="space-y-4">
          <Field label="Produk" required>
            <Select value={ruleForm.product_id} onChange={(e) => setRuleForm((f) => ({ ...f, product_id: e.target.value }))} disabled={!!editingRule}>
              <option value="">— Pilih Produk —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product_code} — {p.product_name} ({p.uom_type})
                </option>
              ))}
            </Select>
          </Field>
          <Grid cols={3}>
            <Field label="Preferred Zone">
              <Select value={ruleForm.preferred_zone_code} onChange={(e) => setRuleForm((f) => ({ ...f, preferred_zone_code: e.target.value }))}>
                {ZONE_TYPES.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </Select>
            </Field>
            <Field label="Max Level (override)">
              <Select value={ruleForm.max_level} onChange={(e) => setRuleForm((f) => ({ ...f, max_level: e.target.value }))}>
                <option value="">Default UOM</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="Allow Pick Face">
              <Select value={ruleForm.allow_pick_face} onChange={(e) => setRuleForm((f) => ({ ...f, allow_pick_face: e.target.value }))}>
                <option value="">Default UOM</option>
                <option value={1}>Ya</option>
                <option value={0}>Tidak</option>
              </Select>
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Full Pallet → Pick Face" hint="Simpan 1 pallet penuh di Level A saat putaway">
              <Select value={ruleForm.full_pallet_to_pick} onChange={(e) => setRuleForm((f) => ({ ...f, full_pallet_to_pick: Number(e.target.value) }))}>
                <option value={1}>Ya</option>
                <option value={0}>Tidak</option>
              </Select>
            </Field>
            <Field label="Konsolidasi (same rack)">
              <Select value={ruleForm.consolidate} onChange={(e) => setRuleForm((f) => ({ ...f, consolidate: Number(e.target.value) }))}>
                <option value={1}>Ya</option>
                <option value={0}>Tidak</option>
              </Select>
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Min Pick-Face Qty" hint="Di bawah ini → trigger replenishment">
              <TextInput type="number" value={ruleForm.min_pick_face_qty} onChange={(e) => setRuleForm((f) => ({ ...f, min_pick_face_qty: Number(e.target.value) }))} />
            </Field>
            <Field label="Max Pick-Face Qty" hint="Target top-up replenishment">
              <TextInput type="number" value={ruleForm.max_pick_face_qty} onChange={(e) => setRuleForm((f) => ({ ...f, max_pick_face_qty: Number(e.target.value) }))} />
            </Field>
          </Grid>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setRuleModal(false)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200">
              Batal
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-60">
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Zone modal */}
      <Modal open={zoneModal} onClose={() => setZoneModal(false)} title={editingZone ? 'Edit Zone' : 'New Zone'} size="md">
        <form onSubmit={saveZone} className="space-y-4">
          <Grid cols={2}>
            <Field label="Zone Code" required>
              <TextInput value={zoneForm.zone_code} onChange={(e) => setZoneForm((f) => ({ ...f, zone_code: e.target.value }))} placeholder="cth: RESERVE" />
            </Field>
            <Field label="Zone Type">
              <Select value={zoneForm.zone_type} onChange={(e) => setZoneForm((f) => ({ ...f, zone_type: e.target.value }))}>
                {ZONE_TYPES.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </Select>
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Nama Zone">
              <TextInput value={zoneForm.zone_name} onChange={(e) => setZoneForm((f) => ({ ...f, zone_name: e.target.value }))} placeholder="cth: Reserve / Bulk (Level B-E)" />
            </Field>
            <Field label="Prioritas" hint="Angka lebih kecil = lebih diprioritaskan">
              <TextInput type="number" value={zoneForm.priority} onChange={(e) => setZoneForm((f) => ({ ...f, priority: Number(e.target.value) }))} />
            </Field>
          </Grid>
          <Field label="Aktif">
            <Select value={zoneForm.is_active} onChange={(e) => setZoneForm((f) => ({ ...f, is_active: Number(e.target.value) }))}>
              <option value={1}>Aktif</option>
              <option value={0}>Nonaktif</option>
            </Select>
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setZoneModal(false)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200">
              Batal
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-60">
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
        ok ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-orange-50 text-orange-700 border-orange-300'
      }`}
    >
      {children}
    </span>
  );
}