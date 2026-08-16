import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageOpen, ClipboardCheck, Truck, ShoppingCart, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Card, EmptyState } from '@/components/Card';
import Spinner from '@/components/Spinner';
import StatusBadge from '@/components/StatusBadge';
import { fmtNum, fmtDate } from '@/lib/format';

const TH = 'px-3 py-2.5 font-bold whitespace-nowrap';
const TD = 'px-3 py-2.5 whitespace-nowrap';

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
  return `${part}, ${name}`;
}

export default function DashboardOutbound() {
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [picklists, setPicklists] = useState<any[]>([]);
  const [pickStats, setPickStats] = useState<any>(null);
  const [waveCount, setWaveCount] = useState(0);
  const [waveRows, setWaveRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [waveLoading, setWaveLoading] = useState(true);
  const [waveError, setWaveError] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    let alive = true;
    Promise.all([
      api('outbound', 'stats'),
      api('outbound', 'list', { params: { per_page: 50 } }),
      api('picklist', 'list', { params: { per_page: 50 } }),
      api('picklist', 'stats'),
    ])
      .then(([s, l, p, ps]) => {
        if (!alive || id !== reqId.current) return;
        setStats(s.stats || {});
        setPending((l.rows || []).filter((o: any) => ['Open', 'Picking'].includes(o.status)));
        setPicklists((p.rows || []).filter((pl: any) => ['Draft', 'Confirmed', 'Picked'].includes(pl.status)));
        setPickStats(ps.stats || {});
      })
      .catch((e: any) => {
        if (alive && id === reqId.current) setError(e.message || 'Gagal memuat dashboard');
      })
      .finally(() => {
        if (alive && id === reqId.current) setLoading(false);
      });

    api('waves', 'list', { params: { per_page: 50 } })
      .then((l: any) => {
        if (!alive || id !== reqId.current) return;
        const active = (l.rows || []).filter(
          (w: any) => w.status !== 'Completed' && w.status !== 'Cancelled',
        );
        setWaveCount(active.length);
        const rows = [...active].sort((a: any, b: any) => {
          const da = a.cutoff_time ? new Date(a.cutoff_time).getTime() : Infinity;
          const db = b.cutoff_time ? new Date(b.cutoff_time).getTime() : Infinity;
          return da - db;
        });
        setWaveRows(rows.slice(0, 10));
      })
      .catch((e: any) => {
        if (alive && id === reqId.current) setWaveError(e.message || 'Gagal memuat wave');
      })
      .finally(() => {
        if (alive && id === reqId.current) setWaveLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const kpi = stats || {};
  const pendingCount = kpi.pending || 0;

  return (
    <div>
      <div className="rounded-xl p-6 mb-5 text-white bg-gradient-to-br from-[#0d1f1f] via-brand-800 to-brand-600 shadow-lg flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-brand-200/90 text-[11px] font-bold uppercase tracking-widest">
            <PackageOpen className="w-4 h-4" /> Outbound Department
          </div>
          <h1 className="text-2xl font-extrabold mt-1.5">{greeting(user?.full_name || 'User')}</h1>
          <p className="text-white/75 text-sm mt-1">Pantau picklist, picking, dan pengiriman.</p>
        </div>
        <Link
          to="/outbound"
          className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold transition backdrop-blur-sm border border-white/20"
        >
          <ShoppingCart className="w-4 h-4" />
          <span className="hidden sm:inline">Buka Outbound</span>
        </Link>
      </div>

      {loading ? (
        <Spinner label="Memuat dashboard..." />
      ) : error ? (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
            <div className="rounded-xl bg-gradient-to-br from-brand-500 to-brand-300 p-4 text-white shadow-sm">
              <ShoppingCart className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(kpi.this_month || 0, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Outbound Bulan Ini</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-amber-500 to-amber-300 p-4 text-white shadow-sm">
              <PackageOpen className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(pendingCount, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Order Open / Picking</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-cyan-600 to-cyan-400 p-4 text-white shadow-sm">
              <ClipboardCheck className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(pickStats?.pending || 0, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Picklist Aktif</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-400 p-4 text-white shadow-sm">
              <Truck className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(pickStats?.completed || 0, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Picklist Selesai</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-indigo-600 to-violet-400 p-4 text-white shadow-sm">
              <Layers className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{waveLoading ? '…' : fmtNum(waveCount, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Wave Aktif</div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <Card
              title="Outbound — Open / Picking"
              actions={
                <Link to="/outbound" className="text-xs font-semibold text-brand-600 hover:underline">
                  Lihat semua
                </Link>
              }
            >
              {pending.length === 0 ? (
                <EmptyState message="Tidak ada outbound terbuka" />
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                        <th className={TH}>Order</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Cross-Dock</th>
                        <th className={TH}>Tanggal</th>
                        <th className={TH}>Customer</th>
                        <th className={TH}>Items</th>
                        <th className={TH}>Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pending.map((o: any) => (
                        <tr key={o.id} className="hover:bg-brand-50 transition-colors">
                          <td className={TD}>
                            <Link to={`/outbound/${o.id}`} className="font-semibold text-brand-600 hover:underline">
                              {o.order_number}
                            </Link>
                          </td>
                          <td className={TD}>
                            <StatusBadge status={o.status} />
                          </td>
                          <td className={TD}>
                            {Number(o.cross_dock_count) > 0 && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-violet-50 text-violet-700 border-violet-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-current" /> Cross-Dock
                              </span>
                            )}
                          </td>
                          <td className={TD}>{fmtDate(o.order_date)}</td>
                          <td className={TD}>{o.customer_name || '—'}</td>
                          <td className={TD}>{fmtNum(o.total_items, 0)}</td>
                          <td className={`${TD} font-semibold`}>{fmtNum(o.total_qty, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Picklist — Aktif"
              actions={
                <Link to="/picklist" className="text-xs font-semibold text-brand-600 hover:underline">
                  Lihat semua
                </Link>
              }
            >
              {picklists.length === 0 ? (
                <EmptyState message="Tidak ada picklist aktif" />
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                        <th className={TH}>Picklist</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Outbound</th>
                        <th className={TH}>Tanggal</th>
                        <th className={TH}>Items</th>
                        <th className={TH}>Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {picklists.map((pl: any) => (
                        <tr key={pl.id} className="hover:bg-brand-50 transition-colors">
                          <td className={TD}>
                            <Link to={`/picklist/${pl.id}`} className="font-semibold text-brand-600 hover:underline">
                              {pl.picklist_no || `PL-${pl.id}`}
                            </Link>
                          </td>
                          <td className={TD}>
                            <StatusBadge status={pl.status} />
                          </td>
                          <td className={TD}>{pl.outbound_number || '—'}</td>
                          <td className={TD}>{fmtDate(pl.created_date)}</td>
                          <td className={TD}>{fmtNum(pl.total_items, 0)}</td>
                          <td className={`${TD} font-semibold`}>{fmtNum(pl.total_qty, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card
            title="Waves — Aktif / Belum Selesai"
            actions={
              <Link to="/waves" className="text-xs font-semibold text-brand-600 hover:underline">
                Lihat semua
              </Link>
            }
          >
            {waveLoading ? (
              <Spinner label="Memuat waves..." />
            ) : waveError ? (
              <div className="px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{waveError}</div>
            ) : waveRows.length === 0 ? (
              <EmptyState message="Tidak ada wave aktif" />
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                      <th className={TH}>Wave</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Carrier</th>
                      <th className={TH}>Cutoff</th>
                      <th className={TH}>Orders</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {waveRows.map((w: any) => (
                      <tr key={w.id} className="hover:bg-brand-50 transition-colors">
                        <td className={TD}>
                          <Link to={`/waves`} className="font-semibold text-brand-600 hover:underline">
                            {w.wave_number}
                          </Link>
                        </td>
                        <td className={TD}>
                          <StatusBadge status={w.status} />
                        </td>
                        <td className={TD}>{w.carrier || '—'}</td>
                        <td className={TD}>{fmtDate(w.cutoff_time)}</td>
                        <td className={`${TD} font-semibold`}>{fmtNum(w.order_count, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}