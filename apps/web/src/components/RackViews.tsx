import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Card } from '@/components/Card';
import Spinner from '@/components/Spinner';
import Rack3D, { Bin3D, ZONE_COLORS, FUNCTION_COLORS } from '@/components/Rack3D';

const LEVELS = ['A', 'B', 'C', 'D', 'E'];
const AISLES = ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG'];

interface AisleMapRow {
  aisle: string;
  level: string;
  total: number;
  occupied: number;
  free: number;
  zone_code: string | null;
  is_pick_face: number;
  equip_accessible: number;
  blocked: number;
}

interface AisleBin {
  location_code: string;
  aisle: string;
  rack: string;
  level: string;
  position: string;
  zone_code: string | null;
  is_pick_face: number;
  equipment_accessible: number;
  quantity: number | null;
  batch_number: string | null;
  product_code: string | null;
  product_name: string | null;
  pallet_function: string | null;
  blocked: number;
  block_reason: string | null;
}

export default function RackViews({ tab }: { tab: 'rackmap' | 'rack3d' }) {
  const toast = useToast();

  const [aisleRows, setAisleRows] = useState<AisleMapRow[]>([]);
  const [aisleBins, setAisleBins] = useState<AisleBin[]>([]);
  const [aisleDetail, setAisleDetail] = useState<{ aisle: string; level: string } | null>(null);
  const [loadingMap, setLoadingMap] = useState(false);

  const [bins, setBins] = useState<Bin3D[]>([]);
  const [hoveredBin, setHoveredBin] = useState<Bin3D | null>(null);
  const [selectedBin, setSelectedBin] = useState<Bin3D | null>(null);

  const loadMap = useCallback(async (aisle?: string, level?: string) => {
    setLoadingMap(true);
    try {
      const params: Record<string, string> = {};
      if (aisle) params.aisle = aisle;
      if (level) params.level = level;
      const res = await api('putaway', 'aisle_map', { params });
      setAisleRows((res.rows || []) as AisleMapRow[]);
      if (aisle && level) setAisleBins((res.locations || []) as AisleBin[]);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat peta rack');
    } finally {
      setLoadingMap(false);
    }
  }, [toast]);

  const loadBins = useCallback(async () => {
    try {
      const res = await api('putaway', 'bins');
      setBins((res.rows || []) as Bin3D[]);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data rack 3D');
    }
  }, [toast]);

  useEffect(() => {
    if (tab === 'rackmap') loadMap();
    else if (tab === 'rack3d') loadBins();
  }, [tab, loadMap, loadBins]);

  const openAisleDetail = async (aisle: string, level: string) => {
    setAisleDetail({ aisle, level });
    await loadMap(aisle, level);
  };

  if (tab === 'rackmap') {
    return (
      <Card title="Peta Rack Aisle × Level (2D)">
        {loadingMap ? (
          <Spinner label="Memuat peta…" />
        ) : aisleDetail ? (
          <>
            <div className="mb-3 flex items-center gap-3">
              <button
                onClick={() => {
                  setAisleDetail(null);
                  loadMap();
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 border border-brand-200 text-xs font-semibold hover:bg-brand-100"
              >
                ← Kembali ke ringkasan
              </button>
              <span className="text-sm text-gray-600 font-semibold">
                Detail {aisleDetail.aisle} · Level {aisleDetail.level}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                    <th className="px-3 py-2.5 text-left font-bold">Lokasi</th>
                    <th className="px-3 py-2.5 text-center font-bold">Zone</th>
                    <th className="px-3 py-2.5 text-center font-bold">Qty</th>
                    <th className="px-3 py-2.5 text-center font-bold">Batch</th>
                    <th className="px-3 py-2.5 text-center font-bold">Produk</th>
                    <th className="px-3 py-2.5 text-center font-bold">Fungsi</th>
                    <th className="px-3 py-2.5 text-center font-bold">Heavy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {aisleBins.map((b) => (
                    <tr key={b.location_code} className="hover:bg-brand-50/50">
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-brand-700">
                        {b.location_code}
                        {Number(b.blocked) === 1 && (
                          <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-600 text-white" title={b.block_reason || ''}>
                            DIBLOKIR
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        <span
                          className="inline-flex px-2 py-0.5 rounded-md text-white text-[11px] font-bold"
                          style={{ backgroundColor: ZONE_COLORS[String(b.zone_code ?? '').toUpperCase()] || '#94a3b8' }}
                        >
                          {b.zone_code || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-gray-600">{b.quantity != null ? fmtNum(b.quantity, 0) : '—'}</td>
                      <td className="px-3 py-2 text-center text-gray-500">{b.batch_number || '—'}</td>
                      <td className="px-3 py-2 text-center text-gray-600">
                        {b.product_name ? (
                          <span className="text-[11px]">{b.product_code} — {b.product_name}</span>
                        ) : (
                          <span className="text-gray-400">Kosong</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {b.quantity != null ? <FungsiBadge fn={b.pallet_function} /> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge ok={Number(b.equipment_accessible) === 1}>{Number(b.equipment_accessible) === 1 ? 'Ya' : 'Tidak'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 text-sm text-gray-500">
              Klik sel untuk melihat detail lokasi per bin. Warna sel = zone; angka = terisi/total.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                    <th className="px-3 py-2.5 text-left font-bold">Aisle</th>
                    {LEVELS.map((l) => (
                      <th key={l} className="px-3 py-2.5 text-center font-bold">Level {l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {AISLES.map((a) => (
                    <tr key={a} className="hover:bg-brand-50/40">
                      <td className="px-3 py-2 font-mono font-semibold text-brand-700">{a}</td>
                      {LEVELS.map((l) => {
                        const r = aisleRows.find((x) => x.aisle === a && x.level === l);
                        return (
                          <td key={l} className="px-3 py-2 text-center">
                            {r ? (
                              <button
                                onClick={() => openAisleDetail(a, l)}
                                title={r.zone_code || ''}
                                className="inline-flex flex-col items-center justify-center w-full min-w-[84px] px-2 py-1.5 rounded-lg text-white text-xs font-bold border border-black/10 hover:brightness-110"
                                style={{
                                  backgroundColor: r.zone_code ? ZONE_COLORS[r.zone_code.toUpperCase()] || '#94a3b8' : '#94a3b8',
                                  opacity: r.total === 0 ? 0.45 : 1,
                                }}
                              >
                                <span>{r.occupied}/{r.total}</span>
                                {Number(r.equip_accessible) > 0 && <span className="text-[9px] font-semibold opacity-90">⚙ {r.equip_accessible}</span>}
                                {Number(r.blocked) > 0 && <span className="text-[9px] font-bold opacity-90" title="Ada bin diblokir">⛔</span>}
                              </button>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    );
  }

  return (
    <Card
      title="Visualisasi Rack 3D"
      actions={
        <div className="flex items-center gap-2 text-[11px]">
          {Object.entries(FUNCTION_COLORS).map(([f, c]) => (
            <span key={f} className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />
              <span className="text-gray-500">{f === 'PICK_FACE' ? 'PICK FACE' : f === 'RESERVE' ? 'BULK' : f}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#475569' }} />
            <span className="text-gray-500">Kosong</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#dc2626' }} />
            <span className="text-gray-500">Diblokir</span>
          </span>
        </div>
      }
    >
      <div className="flex flex-wrap gap-6">
        <div className="relative h-[620px] w-full max-w-[720px] overflow-hidden rounded-xl border border-slate-700">
          <Rack3D
            bins={bins}
            onHover={setHoveredBin}
            onSelect={setSelectedBin}
            selectedKey={selectedBin?.location_code || null}
          />
        </div>
        <div className="min-w-[260px] flex-1">
          {(selectedBin || hoveredBin) && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-bold mb-2">Detail Lokasi</div>
              <div className="font-mono text-xl font-bold text-brand-700">
                {(selectedBin || hoveredBin)!.location_code}
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row label="Aisle / Rack" value={`${(selectedBin || hoveredBin)!.aisle} / ${(selectedBin || hoveredBin)!.rack}`} />
                <Row label="Level / Bin" value={`${(selectedBin || hoveredBin)!.level} / ${(selectedBin || hoveredBin)!.position}`} />
                <Row label="Zone" value={(selectedBin || hoveredBin)!.zone_code || '—'} />
                <Row label="Status" value={(selectedBin || hoveredBin)!.occupied === 1 ? 'Terisi' : 'Kosong'} />
                {Number((selectedBin || hoveredBin)!.quantity) > 0 && (
                  <>
                    <Row label="Qty" value={fmtNum(Number((selectedBin || hoveredBin)!.quantity), 0)} />
                    <Row label="Produk" value={(selectedBin || hoveredBin)!.product_name || '—'} />
                    <Row label="Batch" value={(selectedBin || hoveredBin)!.batch_number || '—'} />
                  </>
                )}
                <Row label="Pick Face" value={Number((selectedBin || hoveredBin)!.is_pick_face) === 1 ? 'Ya' : 'Tidak'} />
                <Row label="Heavy Equip" value={Number((selectedBin || hoveredBin)!.equipment_accessible) === 1 ? 'Ya' : 'Tidak'} />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {Number((selectedBin || hoveredBin)!.quantity) > 0 && (
                    <FungsiBadge fn={(selectedBin || hoveredBin)!.pallet_function} />
                  )}
                  {Number((selectedBin || hoveredBin)!.blocked) === 1 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 text-white text-[11px] font-bold">
                      ⛔ DIBLOKIR — {(selectedBin || hoveredBin)!.block_reason || 'untuk putaway'}
                    </span>
                  )}
                </div>
              </dl>
            </div>
          )}
          {!selectedBin && !hoveredBin && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
              Arahkan / klik lokasi di rack 3D untuk melihat detail. Gunakan mouse untuk memutar & zoom.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-400">{label}</dt>
      <dd className="font-semibold text-gray-700">{value}</dd>
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

function FungsiBadge({ fn }: { fn: string | null }) {
  const v = String(fn ?? '').toUpperCase();
  if (v === 'PICK_FACE') {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-600 text-white">PICK FACE</span>;
  }
  if (v === 'RESERVE') {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-600 text-white">BULK</span>;
  }
  if (v === 'MIXED') {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-600 text-white">MIXED</span>;
  }
  return <span className="text-gray-400">—</span>;
}