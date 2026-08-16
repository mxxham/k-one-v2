import { useEffect, useRef, useState } from 'react';
import {
  History, RefreshCw, Truck, PackageOpen, Boxes, Box, ClipboardList, ClipboardCheck,
  ArrowLeftRight, Users, MapPin, BookOpen, UserCog, BarChart3, LogIn, CalendarCheck2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import Spinner from '@/components/Spinner';
import { Field, Select } from '@/components/Field';
import { fmtDateTime } from '@/lib/format';

const MODULE_ICONS: Record<string, any> = {
  inbound: Truck,
  outbound: PackageOpen,
  stock: Boxes,
  products: Box,
  picklist: ClipboardList,
  stocktake: ClipboardCheck,
  bintransfer: ArrowLeftRight,
  customers: Users,
  locations: MapPin,
  ledger: BookOpen,
  users: UserCog,
  report: BarChart3,
  auth: LogIn,
  cyclecount: CalendarCheck2,
};

function ModuleCell({ row }: { row: any }) {
  const glyph = row.module_icon;
  if (glyph && typeof glyph === 'string' && /[^\x00-\x7F]/.test(glyph)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-[11px] font-semibold">
        <span>{glyph}</span> {row.module}
      </span>
    );
  }
  const Icon = MODULE_ICONS[String(row.module || '').toLowerCase()] || History;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-[11px] font-semibold">
      <Icon className="w-3.5 h-3.5" /> {row.module}
    </span>
  );
}

const TH = 'px-3 py-2.5 font-bold whitespace-nowrap';
const TD = 'px-3 py-2.5 whitespace-nowrap';

export default function ActivityLogPage() {
  const [modules, setModules] = useState<string[]>([]);
  const [moduleFilter, setModuleFilter] = useState('all');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reqId = useRef(0);

  const load = async (mod: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string | number> = { limit: 200 };
      if (mod !== 'all') params.module = mod;
      const res = await api('activitylog', 'list', { params });
      if (reqId.current !== id) return;
      setRows(res.rows ?? []);
    } catch (e: any) {
      if (reqId.current !== id) return;
      setError(e.message || 'Gagal memuat activity log');
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  };

  useEffect(() => {
    api('activitylog', 'modules')
      .then((res) => setModules(Array.isArray(res.rows) ? res.rows : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load(moduleFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleFilter]);

  return (
    <div>
      <PageHeader
        title="Activity Log"
        subtitle="Riwayat aktivitas pengguna di seluruh sistem"
        actions={
          <button
            onClick={() => load(moduleFilter)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-white/20 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <Card
        title={moduleFilter !== 'all' ? `Activity Log — ${moduleFilter}` : 'Activity Log'}
        actions={<span className="text-xs text-gray-500">{rows.length} record</span>}
      >
        <div className="mb-4 max-w-xs">
          <Field label="Modul">
            <Select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
              <option value="all">Semua Modul</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>
        )}

        {loading ? (
          <Spinner label="Memuat..." />
        ) : rows.length === 0 ? (
          <EmptyState message="Tidak ada aktivitas" />
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead className="bg-brand-50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
                  <th className={TH}>Waktu</th>
                  <th className={TH}>Username</th>
                  <th className={TH}>Nama</th>
                  <th className={TH}>Modul</th>
                  <th className={TH}>Aksi</th>
                  <th className={TH}>Referensi</th>
                  <th className={TH}>Deskripsi</th>
                  <th className={TH}>IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r: any) => (
                  <tr
                    key={r.id ?? `${r.created_at}-${r.username}`}
                    className="hover:bg-brand-50 transition-colors align-top"
                  >
                    <td className={`${TD} text-gray-600`}>{fmtDateTime(r.created_at)}</td>
                    <td className={`${TD} font-semibold`}>{r.username || '—'}</td>
                    <td className={TD}>{r.full_name || '—'}</td>
                    <td className={TD}>
                      <ModuleCell row={r} />
                    </td>
                    <td className={`${TD} font-medium text-gray-700`}>{r.action_label || r.action || '—'}</td>
                    <td className={TD}>{r.reference_no || '—'}</td>
                    <td className={`${TD} text-gray-600 min-w-[220px] whitespace-normal`}>{r.description || '—'}</td>
                    <td className={`${TD} text-xs text-gray-400`}>{r.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
