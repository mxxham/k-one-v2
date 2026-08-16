import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, ArrowLeftRight, Boxes, Timer, ShieldAlert, PackageSearch, CalendarCheck2 } from 'lucide-react';
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

export default function DashboardInventory() {
  const { user } = useAuth();
  const [stStats, setStStats] = useState<any>(null);
  const [stockTakes, setStockTakes] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [heldCount, setHeldCount] = useState(0);
  const [replCount, setReplCount] = useState(0);
  const [replRows, setReplRows] = useState<any[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [dueRows, setDueRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [heldLoading, setHeldLoading] = useState(true);
  const [replLoading, setReplLoading] = useState(true);
  const [dueLoading, setDueLoading] = useState(true);
  const [heldError, setHeldError] = useState('');
  const [replError, setReplError] = useState('');
  const [dueError, setDueError] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    let alive = true;
    Promise.all([
      api('stocktake', 'list', { params: { limit: 50 } }),
      api('bintransfer', 'list', { params: { per_page: 50 } }),
    ])
      .then(([st, bt]) => {
        if (!alive || id !== reqId.current) return;
        setStStats(st.stats || {});
        setStockTakes((st.rows || []).filter((s: any) => !['Completed', 'Adjusted'].includes(s.status)));
        setTransfers((bt.rows || []).filter((t: any) => t.status === 'Pending'));
      })
      .catch((e: any) => {
        if (alive && id === reqId.current) setError(e.message || 'Gagal memuat dashboard');
      })
      .finally(() => {
        if (alive && id === reqId.current) setLoading(false);
      });

    api('stock', 'list')
      .then((l: any) => {
        if (!alive || id !== reqId.current) return;
        const held = (l.rows || []).filter((r: any) => r.hold_status && r.hold_status !== 'available');
        setHeldCount(held.length);
      })
      .catch((e: any) => {
        if (alive && id === reqId.current) setHeldError(e.message || 'Gagal memuat stok di-hold');
      })
      .finally(() => {
        if (alive && id === reqId.current) setHeldLoading(false);
      });

    api('replenishment', 'list')
      .then((s: any) => {
        if (!alive || id !== reqId.current) return;
        const all = s.suggestions || [];
        setReplCount(all.length);
        const rows = [...all].sort((a: any, b: any) => Number(b.shortage) - Number(a.shortage));
        setReplRows(rows.slice(0, 10));
      })
      .catch((e: any) => {
        if (alive && id === reqId.current) setReplError(e.message || 'Gagal memuat replenishment');
      })
      .finally(() => {
        if (alive && id === reqId.current) setReplLoading(false);
      });

    api('cyclecount', 'list')
      .then((l: any) => {
        if (!alive || id !== reqId.current) return;
        const due = (l.rows || []).filter((c: any) => c.is_due === true || c.is_due === 'true' || c.is_due === 't');
        setDueCount(due.length);
        setDueRows(due.slice(0, 10));
      })
      .catch((e: any) => {
        if (alive && id === reqId.current) setDueError(e.message || 'Gagal memuat cycle count');
      })
      .finally(() => {
        if (alive && id === reqId.current) setDueLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <div className="rounded-xl p-6 mb-5 text-white bg-gradient-to-br from-[#0d1f1f] via-brand-800 to-brand-600 shadow-lg flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-brand-200/90 text-[11px] font-bold uppercase tracking-widest">
            <Boxes className="w-4 h-4" /> Inventory Department
          </div>
          <h1 className="text-2xl font-extrabold mt-1.5">{greeting(user?.full_name || 'User')}</h1>
          <p className="text-white/75 text-sm mt-1">Pantau stock take & bin transfer.</p>
        </div>
        <Link
          to="/stocktake"
          className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold transition backdrop-blur-sm border border-white/20"
        >
          <ClipboardCheck className="w-4 h-4" />
          <span className="hidden sm:inline">Buka Stock Take</span>
        </Link>
      </div>

      {loading ? (
        <Spinner label="Memuat dashboard..." />
      ) : error ? (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 mb-5">
            <div className="rounded-xl bg-gradient-to-br from-brand-500 to-brand-300 p-4 text-white shadow-sm">
              <ClipboardCheck className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(stStats?.total || 0, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Total Stock Take</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-purple-600 to-purple-400 p-4 text-white shadow-sm">
              <ClipboardCheck className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(stStats?.this_month || 0, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Bulan Ini</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-400 p-4 text-white shadow-sm">
              <Timer className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(stStats?.avg_accuracy ?? 100, 0)}%</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Avg Akurasi</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-orange-500 to-orange-300 p-4 text-white shadow-sm">
              <ArrowLeftRight className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(transfers.length, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Bin Transfer Pending</div>
            </div>
            <Link
              to="/stock"
              className="rounded-xl bg-gradient-to-br from-red-500 to-rose-400 p-4 text-white shadow-sm block hover:opacity-90 transition"
            >
              <ShieldAlert className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{heldLoading ? '…' : fmtNum(heldCount, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Stok Di-Hold / Karantina</div>
            </Link>
            <Link
              to="/replenishment"
              className="rounded-xl bg-gradient-to-br from-teal-600 to-teal-400 p-4 text-white shadow-sm block hover:opacity-90 transition"
            >
              <PackageSearch className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{replLoading ? '…' : fmtNum(replCount, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Replenishment Dibutuhkan</div>
            </Link>
            <Link
              to="/cycle-count"
              className="rounded-xl bg-gradient-to-br from-fuchsia-600 to-pink-400 p-4 text-white shadow-sm block hover:opacity-90 transition"
            >
              <CalendarCheck2 className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{dueLoading ? '…' : fmtNum(dueCount, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Cycle Count Jatuh Tempo</div>
            </Link>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <Card
              title="Stock Take — Berjalan"
              actions={
                <Link to="/stocktake" className="text-xs font-semibold text-brand-600 hover:underline">
                  Lihat semua
                </Link>
              }
            >
              {stockTakes.length === 0 ? (
                <EmptyState message="Tidak ada stock take berjalan" />
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                        <th className={TH}>No</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Tanggal</th>
                        <th className={TH}>Scope</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {stockTakes.map((s: any) => (
                        <tr key={s.id} className="hover:bg-brand-50 transition-colors">
                          <td className={TD}>
                            <Link to={`/stocktake/${s.id}`} className="font-semibold text-brand-600 hover:underline">
                              {s.take_number || `ST-${s.id}`}
                            </Link>
                          </td>
                          <td className={TD}>
                            <StatusBadge status={s.status} />
                          </td>
                          <td className={TD}>{fmtDate(s.take_date)}</td>
                          <td className={TD}>{s.scope || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Bin Transfer — Pending"
              actions={
                <Link to="/bin-transfer" className="text-xs font-semibold text-brand-600 hover:underline">
                  Lihat semua
                </Link>
              }
            >
              {transfers.length === 0 ? (
                <EmptyState message="Tidak ada bin transfer pending" />
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                        <th className={TH}>No</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Tanggal</th>
                        <th className={TH}>Dari</th>
                        <th className={TH}>Ke</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {transfers.map((t: any) => (
                        <tr key={t.id} className="hover:bg-brand-50 transition-colors">
                          <td className={TD}>
                            <Link to={`/bin-transfer`} className="font-semibold text-brand-600 hover:underline">
                              {t.transfer_number || `BT-${t.id}`}
                            </Link>
                          </td>
                          <td className={TD}>
                            <StatusBadge status={t.status} />
                          </td>
                          <td className={TD}>{fmtDate(t.created_date || t.created_at)}</td>
                          <td className={TD}>{t.from_location || '—'}</td>
                          <td className={TD}>{t.to_location || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <Card
              title="Replenishment — Dibutuhkan"
              actions={
                <Link to="/replenishment" className="text-xs font-semibold text-brand-600 hover:underline">
                  Lihat semua
                </Link>
              }
            >
              {replLoading ? (
                <Spinner label="Memuat replenishment..." />
              ) : replError ? (
                <div className="px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{replError}</div>
              ) : replRows.length === 0 ? (
                <EmptyState message="Tidak ada replenishment dibutuhkan" />
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                        <th className={TH}>Produk</th>
                        <th className={TH}>Lokasi</th>
                        <th className={TH}>Stok</th>
                        <th className={TH}>Min</th>
                        <th className={TH}>Kekurangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {replRows.map((r: any) => (
                        <tr key={r.target_id ?? `${r.product_id}-${r.location_id}`} className="hover:bg-brand-50 transition-colors">
                          <td className={TD}>
                            <div className="font-semibold text-brand-600">{r.product_code || '—'}</div>
                            <div className="text-xs text-gray-500">{r.product_name || '—'}</div>
                          </td>
                          <td className={TD}>{r.pick_face_location || '—'}</td>
                          <td className={TD}>{fmtNum(r.current_qty, 0)}</td>
                          <td className={TD}>{fmtNum(r.min_qty, 0)}</td>
                          <td className={`${TD} font-semibold text-red-600`}>{fmtNum(r.shortage, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Cycle Count — Jatuh Tempo"
              actions={
                <Link to="/cycle-count" className="text-xs font-semibold text-brand-600 hover:underline">
                  Lihat semua
                </Link>
              }
            >
              {dueLoading ? (
                <Spinner label="Memuat cycle count..." />
              ) : dueError ? (
                <div className="px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{dueError}</div>
              ) : dueRows.length === 0 ? (
                <EmptyState message="Tidak ada cycle count jatuh tempo" />
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                        <th className={TH}>Jadwal</th>
                        <th className={TH}>Frekuensi</th>
                        <th className={TH}>Berikutnya</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {dueRows.map((c: any) => (
                        <tr key={c.id} className="hover:bg-brand-50 transition-colors">
                          <td className={`${TD} font-semibold text-brand-600`}>{c.schedule_name || '—'}</td>
                          <td className={TD}>{c.frequency || '—'}</td>
                          <td className={TD}>{fmtDate(c.next_run_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}