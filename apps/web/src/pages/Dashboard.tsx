import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Warehouse, Droplets, Boxes, Timer, AlertTriangle, ArrowDownToLine,
  PackageOpen, Truck, MapPin,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Card, EmptyState } from '@/components/Card';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import StatusBadge from '@/components/StatusBadge';
import { fmtNum, fmtDate, expiryInfo } from '@/lib/format';

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
  return `${part}, ${name}`;
}

function expiryCell(v?: string | null) {
  const info = expiryInfo(v);
  const cls: Record<string, string> = {
    ok: 'text-emerald-600',
    warning: 'text-orange-600',
    critical: 'text-amber-600 font-semibold',
    expired: 'text-red-600 font-semibold',
    none: 'text-gray-400',
  };
  return <span className={cls[info.level]}>{info.text}</span>;
}

const TH = 'px-3 py-2.5 font-bold whitespace-nowrap';
const TD = 'px-3 py-2.5 whitespace-nowrap';

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(new Date());
  const [aisle, setAisle] = useState<string | null>(null);
  const [aisleDetail, setAisleDetail] = useState<any>(null);
  const [aisleLoading, setAisleLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    let alive = true;
    api('dashboard', 'stats')
      .then((res) => {
        if (alive && id === reqId.current) setData(res);
      })
      .catch((e: any) => {
        if (alive && id === reqId.current) setError(e.message || 'Gagal memuat dashboard');
      })
      .finally(() => {
        if (alive && id === reqId.current) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const openAisle = async (a: string) => {
    setAisle(a);
    setAisleDetail(null);
    setAisleLoading(true);
    try {
      const res = await api('dashboard', 'aisle_detail', { params: { aisle: a } });
      setAisleDetail(res);
    } catch (e: any) {
      setAisleDetail({ locations: [], stats: null, error: e.message || 'Gagal memuat detail aisle' });
    } finally {
      setAisleLoading(false);
    }
  };

  const kpi = data?.kpi || {};
  const pipeline = (kpi.dues_in || 0) + (kpi.receiving_now || 0);
  const expiredDetail = data?.expired_detail || [];
  const stockSummary = data?.stock_summary || [];
  const monthly = data?.monthly_activity || [];
  const stockByLocation = data?.stock_by_location || [];
  const pendingInbound = data?.pending_inbound || [];
  const pendingOutbound = data?.pending_outbound || [];

  const kpiCards = [
    { label: 'Total Drums', value: kpi.total_drums, icon: Droplets, grad: 'from-brand-500 to-brand-300' },
    { label: 'Total Pallets', value: kpi.total_pallets, icon: Boxes, grad: 'from-[#0d1f1f] to-brand-700' },
    { label: 'Expiring Soon', value: kpi.expiring_soon, icon: Timer, grad: 'from-amber-500 to-orange-400' },
    { label: 'Expired Items', value: kpi.expired_items, icon: AlertTriangle, grad: 'from-red-500 to-red-400' },
    { label: 'Dues In / Receiving', value: pipeline, icon: ArrowDownToLine, grad: 'from-sky-600 to-sky-400' },
    { label: 'Pending Outbound', value: kpi.pending_outbound, icon: PackageOpen, grad: 'from-violet-600 to-violet-400' },
  ];

  const maxQty = Math.max(
    1,
    ...monthly.map((m: any) => Math.max(Number(m.inbound_qty) || 0, Number(m.outbound_qty) || 0)),
  );

  return (
    <div>
      {/* Hero banner */}
      <div className="rounded-xl p-6 mb-5 text-white bg-gradient-to-br from-[#0d1f1f] via-brand-800 to-brand-600 shadow-lg flex items-center justify-between gap-4 flex-wrap overflow-hidden relative">
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full bg-brand-400/20 blur-2xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-brand-200/90 text-[11px] font-bold uppercase tracking-widest">
            <Warehouse className="w-4 h-4" /> K-one Warehouse Management System
          </div>
          <h1 className="text-2xl font-extrabold mt-1.5">{greeting(user?.full_name || 'User')}</h1>
          <p className="text-white/75 text-sm mt-1 capitalize">
            {now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="relative text-right">
          <div className="text-4xl font-extrabold tabular-nums leading-none">
            {now.toLocaleTimeString('en-GB', { hour12: false })}
          </div>
          <div className="text-[11px] text-white/70 uppercase tracking-widest mt-1.5">Live Clock</div>
        </div>
      </div>

      {loading ? (
        <Spinner label="Memuat dashboard..." />
      ) : error ? (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-5">
            {kpiCards.map((k) => (
              <div key={k.label} className={`rounded-xl bg-gradient-to-br ${k.grad} p-4 text-white shadow-sm`}>
                <k.icon className="w-4 h-4 opacity-80" />
                <div className="text-2xl font-extrabold mt-2">{fmtNum(k.value, 0)}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Expired alert strip */}
          {expiredDetail.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 mb-5 overflow-hidden">
              <div className="flex items-center gap-2 text-red-700 font-bold text-sm mb-3">
                <AlertTriangle className="w-4 h-4" /> Expired Items Ditemukan
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-red-100/60">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-red-800">
                      <th className={TH}>Kode</th>
                      <th className={TH}>Produk</th>
                      <th className={TH}>Batch</th>
                      <th className={TH}>Expiry</th>
                      <th className={TH}>Qty</th>
                      <th className={TH}>Pallet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {expiredDetail.map((r: any, i: number) => (
                      <tr key={r.id || `${r.product_code}-${i}`} className="hover:bg-red-50 transition-colors">
                        <td className={`${TD} font-semibold`}>{r.product_code}</td>
                        <td className={TD}>{r.product_name}</td>
                        <td className={TD}>{r.batch_number || '—'}</td>
                        <td className={`${TD} text-red-600 font-semibold`}>{expiryCell(r.expiry_date)}</td>
                        <td className={TD}>{fmtNum(r.qty, 0)}</td>
                        <td className={TD}>{fmtNum(r.pallet, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Work queues */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <Card
              title="Inbound — Dues In / Receiving"
              actions={
                <Link to="/inbound" className="text-xs font-semibold text-brand-600 hover:underline">
                  Lihat semua
                </Link>
              }
            >
              {pendingInbound.length === 0 ? (
                <EmptyState message="Tidak ada inbound menunggu" />
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                        <th className={TH}>Order</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Tanggal</th>
                        <th className={TH}>Shipment</th>
                        <th className={TH}>Carrier</th>
                        <th className={TH}>Items</th>
                        <th className={TH}>Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pendingInbound.map((o: any) => (
                        <tr key={o.id} className="hover:bg-brand-50 transition-colors">
                          <td className={TD}>
                            <Link to={`/inbound/${o.id}`} className="font-semibold text-brand-600 hover:underline">
                              {o.order_number}
                            </Link>
                          </td>
                          <td className={TD}>
                            <StatusBadge status={o.status} />
                          </td>
                          <td className={TD}>{fmtDate(o.order_date)}</td>
                          <td className={TD}>{o.shipment_no || '—'}</td>
                          <td className={TD}>{o.carrier_name || '—'}</td>
                          <td className={TD}>{fmtNum(o.line_count, 0)}</td>
                          <td className={`${TD} font-semibold`}>{fmtNum(o.total_qty, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Outbound — Open / Picking"
              actions={
                <Link to="/outbound" className="text-xs font-semibold text-brand-600 hover:underline">
                  Lihat semua
                </Link>
              }
            >
              {pendingOutbound.length === 0 ? (
                <EmptyState message="Tidak ada outbound terbuka" />
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                        <th className={TH}>Order</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Tanggal</th>
                        <th className={TH}>Shipment</th>
                        <th className={TH}>Items</th>
                        <th className={TH}>Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pendingOutbound.map((o: any) => (
                        <tr key={o.id} className="hover:bg-brand-50 transition-colors">
                          <td className={TD}>
                            <Link to={`/outbound/${o.id}`} className="font-semibold text-brand-600 hover:underline">
                              {o.order_number}
                            </Link>
                          </td>
                          <td className={TD}>
                            <StatusBadge status={o.status} />
                          </td>
                          <td className={TD}>{fmtDate(o.order_date)}</td>
                          <td className={TD}>{o.shipment_number || '—'}</td>
                          <td className={TD}>{fmtNum(o.line_count, 0)}</td>
                          <td className={`${TD} font-semibold`}>{fmtNum(o.total_qty, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Stock summary */}
          <Card title="Stock Summary">
            {stockSummary.length === 0 ? (
              <EmptyState message="Tidak ada data stok" />
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                      <th className={TH}>Kode</th>
                      <th className={TH}>Produk</th>
                      <th className={TH}>UOM</th>
                      <th className={TH}>Batch</th>
                      <th className={TH}>Total Qty</th>
                      <th className={TH}>Total Pallet</th>
                      <th className={TH}>Exp Terdekat</th>
                      <th className={TH}>Segera Exp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {stockSummary.map((r: any) => (
                      <tr key={r.id} className="hover:bg-brand-50 transition-colors">
                        <td className={TD}>
                          <Link to={`/stock?q=${encodeURIComponent(r.product_code)}`} className="font-semibold text-brand-600 hover:underline">
                            {r.product_code}
                          </Link>
                        </td>
                        <td className={TD}>{r.product_name}</td>
                        <td className={TD}>{r.uom_type || '—'}</td>
                        <td className={TD}>{r.batches ?? '—'}</td>
                        <td className={`${TD} font-semibold`}>{fmtNum(r.total_qty, 0)}</td>
                        <td className={TD}>{fmtNum(r.total_pallet, 0)}</td>
                        <td className={TD}>{expiryCell(r.nearest_expiry)}</td>
                        <td className={TD}>
                          {Number(r.expiring_count) > 0 ? (
                            <span className="inline-flex px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold">
                              {r.expiring_count}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Monthly activity + aisles */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Card title="Monthly Activity">
              <div className="flex items-center gap-4 text-[11px] text-gray-500 mb-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-brand-500" /> Inbound
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Outbound
                </span>
              </div>
              {monthly.length === 0 ? (
                <EmptyState message="Belum ada aktivitas bulanan" />
              ) : (
                <div className="flex items-end gap-1.5 h-40">
                  {monthly.map((m: any) => {
                    const inQ = Number(m.inbound_qty) || 0;
                    const outQ = Number(m.outbound_qty) || 0;
                    const ml = String(m.month || '');
                    const monthLabel = /^\d{4}-\d{2}/.test(ml)
                      ? new Date(`${ml}-01`).toLocaleDateString('en-GB', { month: 'short' })
                      : ml;
                    return (
                      <div key={ml} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                        <div className="flex items-end justify-center gap-1 h-28 w-full">
                          <div
                            className="w-2.5 rounded-t bg-brand-500 transition-all"
                            style={{ height: `${Math.round((inQ / maxQty) * 100)}%` }}
                            title={`Inbound ${fmtNum(inQ, 0)}`}
                          />
                          <div
                            className="w-2.5 rounded-t bg-amber-400 transition-all"
                            style={{ height: `${Math.round((outQ / maxQty) * 100)}%` }}
                            title={`Outbound ${fmtNum(outQ, 0)}`}
                          />
                        </div>
                        <span className="text-[10px] text-gray-500 truncate max-w-full">{monthLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Aisle / Stock by Location">
              {stockByLocation.length === 0 ? (
                <EmptyState message="Tidak ada data lokasi" />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {stockByLocation.map((l: any) => {
                    const pct = l.total_locs ? Math.round((l.occupied_locs / l.total_locs) * 100) : 0;
                    return (
                      <button
                        key={l.aisle}
                        onClick={() => openAisle(l.aisle)}
                        className="text-left rounded-xl border border-gray-200 p-3.5 hover:border-brand-400 hover:shadow-md transition bg-white group"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-brand-700 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5" /> Aisle {l.aisle}
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-600">{pct}%</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-2">
                          {l.occupied_locs}/{l.total_locs} lokasi
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="font-semibold text-gray-800">{fmtNum(l.total_qty, 0)}</span>
                          <span className="text-xs text-gray-400">{fmtNum(l.total_pallet, 0)} pallet</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Aisle detail modal */}
      <Modal open={!!aisle} onClose={() => setAisle(null)} title={`Detail Aisle ${aisle ?? ''}`} size="lg">
        {aisleLoading ? (
          <Spinner label="Memuat detail..." />
        ) : aisleDetail ? (
          <>
            {aisleDetail.error && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
                {aisleDetail.error}
              </div>
            )}
            {aisleDetail.stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  ['Total Lokasi', aisleDetail.stats.total],
                  ['Terisi', aisleDetail.stats.occupied],
                  ['Total Qty', fmtNum(aisleDetail.stats.total_qty, 0)],
                  ['Total Pallet', fmtNum(aisleDetail.stats.total_pallet, 0)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg bg-brand-50 px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-brand-600 font-bold">{label}</div>
                    <div className="text-lg font-extrabold text-brand-800">{String(value ?? 0)}</div>
                  </div>
                ))}
              </div>
            )}
            {aisleDetail.locations?.length === 0 ? (
              <EmptyState message="Tidak ada lokasi terisi di aisle ini" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                      <th className={TH}>Kode</th>
                      <th className={TH}>Rack</th>
                      <th className={TH}>Row</th>
                      <th className={TH}>Zone</th>
                      <th className={TH}>Produk</th>
                      <th className={TH}>Qty</th>
                      <th className={TH}>Pallet</th>
                      <th className={TH}>Batch</th>
                      <th className={TH}>Expiry</th>
                      <th className={TH}>Tipe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(aisleDetail.locations || []).map((l: any) => (
                      <tr
                        key={l.code || l.id}
                        className={`${l.is_partial || l.is_eceran ? 'bg-amber-50/70 hover:bg-amber-100/70' : 'hover:bg-brand-50'} transition-colors`}
                      >
                        <td className={`${TD} font-semibold`}>{l.code}</td>
                        <td className={TD}>{l.rack || '—'}</td>
                        <td className={TD}>{l.row_name || '—'}</td>
                        <td className={TD}>{l.zone || '—'}</td>
                        <td className={TD}>
                          <div className="font-medium">{l.product || '—'}</div>
                          <div className="text-[10px] text-gray-400">{l.product_code}</div>
                        </td>
                        <td className={`${TD} font-semibold`}>{fmtNum(l.qty, 0)}</td>
                        <td className={TD}>{fmtNum(l.pallet, 0)}</td>
                        <td className={TD}>{l.batch || '—'}</td>
                        <td className={TD}>{expiryCell(l.expiry)}</td>
                        <td className={TD}>
                          {(l.is_partial || l.is_eceran) && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              {l.is_eceran ? 'Eceran' : 'Partial'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <EmptyState message="Tidak ada data" />
        )}
      </Modal>
    </div>
  );
}
