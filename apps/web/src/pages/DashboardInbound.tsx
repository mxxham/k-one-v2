import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Truck, ArrowDownToLine, PackageOpen, ClipboardList, CalendarClock } from 'lucide-react';
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

export default function DashboardInbound() {
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [asnCount, setAsnCount] = useState(0);
  const [asnRows, setAsnRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [asnLoading, setAsnLoading] = useState(true);
  const [asnError, setAsnError] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    let alive = true;
    Promise.all([api('inbound', 'stats'), api('inbound', 'list', { params: { per_page: 50 } })])
      .then(([s, l]) => {
        if (!alive || id !== reqId.current) return;
        setStats(s.stats || {});
        setPending((l.rows || []).filter((o: any) => ['Dues In', 'Receiving', 'Goods Received'].includes(o.status)));
      })
      .catch((e: any) => {
        if (alive && id === reqId.current) setError(e.message || 'Gagal memuat dashboard');
      })
      .finally(() => {
        if (alive && id === reqId.current) setLoading(false);
      });

    api('asn', 'list', { params: { status: 'Pending', per_page: 50 } })
      .then((l: any) => {
        if (!alive || id !== reqId.current) return;
        setAsnCount(l.total ?? (l.rows || []).length);
        const rows = (l.rows || [])
          .filter((a: any) => a.status === 'Pending')
          .sort((a: any, b: any) => {
            const da = a.expected_arrival_date ? new Date(a.expected_arrival_date).getTime() : Infinity;
            const db = b.expected_arrival_date ? new Date(b.expected_arrival_date).getTime() : Infinity;
            return da - db;
          });
        setAsnRows(rows.slice(0, 10));
      })
      .catch((e: any) => {
        if (alive && id === reqId.current) setAsnError(e.message || 'Gagal memuat ASN');
      })
      .finally(() => {
        if (alive && id === reqId.current) setAsnLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const kpi = stats || {};
  const receiving = kpi.receiving || 0;
  const duesIn = kpi.dues_in || kpi.pending || 0;
  const doneToday = (kpi.by_status || []).reduce((acc: number, r: any) => {
    if (['ATP', 'Goods Received', 'Completed'].includes(r.status)) acc += Number(r.count) || 0;
    return acc;
  }, 0);

  return (
    <div>
      <div className="rounded-xl p-6 mb-5 text-white bg-gradient-to-br from-[#0d1f1f] via-brand-800 to-brand-600 shadow-lg flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-brand-200/90 text-[11px] font-bold uppercase tracking-widest">
            <Truck className="w-4 h-4" /> Inbound Department
          </div>
          <h1 className="text-2xl font-extrabold mt-1.5">{greeting(user?.full_name || 'User')}</h1>
          <p className="text-white/75 text-sm mt-1">Pantau penerimaan & putaway yang masuk.</p>
        </div>
        <Link
          to="/inbound"
          className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold transition backdrop-blur-sm border border-white/20"
        >
          <ArrowDownToLine className="w-4 h-4" />
          <span className="hidden sm:inline">Buka Inbound</span>
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
              <ClipboardList className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(kpi.this_month || 0, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Inbound Bulan Ini</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-sky-600 to-sky-400 p-4 text-white shadow-sm">
              <ArrowDownToLine className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(duesIn, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Dues In</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-orange-500 to-orange-300 p-4 text-white shadow-sm">
              <PackageOpen className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(receiving, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Receiving</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-400 p-4 text-white shadow-sm">
              <Truck className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{fmtNum(doneToday, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">Selesai Diterima</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-violet-600 to-indigo-400 p-4 text-white shadow-sm">
              <CalendarClock className="w-5 h-5 opacity-80" />
              <div className="text-2xl font-extrabold mt-2">{asnLoading ? '…' : fmtNum(asnCount, 0)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">ASN Pending</div>
            </div>
          </div>

          <Card
            title="Inbound — Dues In / Receiving / Goods Received"
            actions={
              <Link to="/inbound" className="text-xs font-semibold text-brand-600 hover:underline">
                Lihat semua
              </Link>
            }
          >
            {pending.length === 0 ? (
              <EmptyState message="Tidak ada inbound menunggu" />
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                      <th className={TH}>Order</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Cross-Dock</th>
                      <th className={TH}>Tanggal</th>
                      <th className={TH}>Shipment</th>
                      <th className={TH}>Carrier</th>
                      <th className={TH}>Items</th>
                      <th className={TH}>Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pending.map((o: any) => (
                      <tr key={o.id} className="hover:bg-brand-50 transition-colors">
                        <td className={TD}>
                          <Link to={`/inbound/${o.id}`} className="font-semibold text-brand-600 hover:underline">
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
                        <td className={TD}>{o.shipment_no || '—'}</td>
                        <td className={TD}>{o.carrier_name || '—'}</td>
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
            title="ASN — Pending Kedatangan"
            actions={
              <Link to="/asn" className="text-xs font-semibold text-brand-600 hover:underline">
                Lihat semua
              </Link>
            }
          >
            {asnLoading ? (
              <Spinner label="Memuat ASN..." />
            ) : asnError ? (
              <div className="px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{asnError}</div>
            ) : asnRows.length === 0 ? (
              <EmptyState message="Tidak ada ASN pending" />
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                      <th className={TH}>ASN No</th>
                      <th className={TH}>Supplier</th>
                      <th className={TH}>Kedatangan Diharapkan</th>
                      <th className={TH}>Lines</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {asnRows.map((a: any) => (
                      <tr key={a.id} className="hover:bg-brand-50 transition-colors">
                        <td className={TD}>
                          <Link to={`/asn/${a.id}`} className="font-semibold text-brand-600 hover:underline">
                            {a.asn_number}
                          </Link>
                        </td>
                        <td className={TD}>{a.supplier_name || '—'}</td>
                        <td className={TD}>{fmtDate(a.expected_arrival_date)}</td>
                        <td className={`${TD} font-semibold`}>{fmtNum(a.total_items, 0)}</td>
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