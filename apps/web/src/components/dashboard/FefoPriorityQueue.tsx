import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Package } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import Spinner from '@/components/Spinner';
import { EmptyState } from '@/components/Card';


interface FefoItem {
  id: number;
  product_code: string;
  product_name: string;
  batch_number: string;
  expiry_date: string;
  location: string;
  quantity: number;
  pallet: number;
  uom: string;
  priority_level: 'expired' | 'critical' | 'warning' | 'safe';
  days_remaining: number;
}

interface FefoSummary {
  total: number;
  years: { year: number; count: number; quantity: number }[];
}

interface FefoQueueData {
  summary: FefoSummary;
  queue: FefoItem[];
}

const TH = 'px-3 py-2.5 font-bold whitespace-nowrap text-left';
const TD = 'px-3 py-2.5 whitespace-nowrap';

function priorityColor(level: string) {
  switch (level) {
    case 'expired': return 'text-red-600 bg-red-50 border-red-200';
    case 'critical': return 'text-orange-600 bg-orange-50 border-orange-200';
    case 'warning': return 'text-amber-600 bg-amber-50 border-amber-200';
    case 'safe': return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    default: return 'text-gray-600 bg-gray-50 border-gray-200';
  }
}

const YEAR_SEGMENT_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-400',
  'bg-lime-500',
  'bg-emerald-500',
  'bg-teal-500',
];

function priorityLabel(level: string) {
  switch (level) {
    case 'expired': return 'EXPIRED';
    case 'critical': return 'CRITICAL';
    case 'warning': return 'WARNING';
    case 'safe': return 'SAFE';
    default: return level.toUpperCase();
  }
}

export default function FefoPriorityQueue({ limit = 10 }: { limit?: number }) {
  const navigate = useNavigate();
  const [data, setData] = useState<FefoQueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadFefoQueue();
  }, [limit]);

  const loadFefoQueue = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api('dashboard', 'fefo_queue', { params: { limit: expanded ? 50 : limit } });
      setData({ summary: res.summary, queue: res.queue });
    } catch (e: any) {
      setError(e.message || 'Gagal memuat FEFO queue');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
        <Spinner label="Memuat FEFO Priority Queue..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="text-red-700 text-sm">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { summary, queue } = data;
  const displayQueue = expanded ? queue : queue.slice(0, limit);
  const totalItems = summary.total;
  const firstYear = summary.years[0] || null;
  const years = summary.years;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold">FEFO Priority Queue</h2>
              <p className="text-brand-100 text-xs">First Expired, First Out • Prioritas Picking</p>
            </div>
          </div>
            <div className="flex items-center gap-5">
            <div className="text-right">
              <div className="text-2xl font-extrabold">{totalItems}</div>
              <div className="text-[10px] uppercase tracking-widest opacity-80">Total Batches</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-extrabold text-red-300">{firstYear ? firstYear.year : '—'}</div>
              <div className="text-[10px] uppercase tracking-widest opacity-80">First to Expire</div>
              <div className="text-[11px] font-bold text-red-200 mt-0.5">
                {firstYear ? `${firstYear.count} batches • ${fmtNum(firstYear.quantity, 0)} units` : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Visual Timeline (by expiry year) */}
        <div className="mt-4">
          <div className="flex items-center h-3 rounded-full overflow-hidden bg-white/10">
            {years.map((y, i) => {
              const pct = totalItems > 0 ? (y.count / totalItems) * 100 : 0;
              return pct > 0 ? (
                <div
                  key={y.year}
                  className={`h-full ${YEAR_SEGMENT_COLORS[i % YEAR_SEGMENT_COLORS.length]} cursor-pointer hover:opacity-80 transition-opacity`}
                  style={{ width: `${pct}%` }}
                  title={`${y.year}: ${y.count} batches (${fmtNum(y.quantity, 0)} units) — klik untuk lihat`}
                  onClick={() => navigate(`/stock?year=${y.year}`)}
                />
              ) : null;
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px] font-semibold uppercase tracking-wider">
            {years.map((y, i) => (
              <button
                key={y.year}
                onClick={() => navigate(`/stock?year=${y.year}`)}
                title={`Klik untuk melihat stock expire ${y.year}`}
                className="flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity"
              >
                <span className={`inline-block w-2 h-2 rounded-full ${YEAR_SEGMENT_COLORS[i % YEAR_SEGMENT_COLORS.length]}`} />
                {y.year} • {y.count}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Queue Table */}
      <div className="p-5">
        {displayQueue.length === 0 ? (
          <EmptyState message="Tidak ada stock dengan expiry date" />
        ) : (
          <>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-y border-gray-200">
                  <tr className="text-[11px] uppercase tracking-wide text-gray-700">
                    <th className={TH}>Priority</th>
                    <th className={TH}>Product</th>
                    <th className={TH}>Batch</th>
                    <th className={TH}>Location</th>
                    <th className={TH}>Qty</th>
                    <th className={TH}>Pallet</th>
                    <th className={TH}>Expiry Date</th>
                    <th className={TH}>Days</th>
                    <th className={TH}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {displayQueue.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/stock?q=${encodeURIComponent(item.product_code)}`)}
                      title={`Lihat ${item.product_name} di halaman Stock`}
                      className={`hover:bg-${item.priority_level === 'expired' ? 'red' : item.priority_level === 'critical' ? 'orange' : item.priority_level === 'warning' ? 'amber' : 'gray'}-50 transition-colors cursor-pointer`}
                    >
                      <td className={TD}>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider ${priorityColor(item.priority_level)}`}>
                          {item.priority_level === 'expired' && <AlertTriangle className="w-3 h-3" />}
                          {item.priority_level === 'critical' && <Clock className="w-3 h-3" />}
                          {priorityLabel(item.priority_level)}
                        </span>
                      </td>
                      <td className={TD}>
                        <div className="font-semibold text-brand-700 hover:underline">{item.product_name}</div>
                        <div className="text-[10px] text-gray-500">{item.product_code}</div>
                      </td>
                      <td className={`${TD} font-mono text-xs`}>{item.batch_number || '—'}</td>
                      <td className={`${TD} font-mono text-xs`}>{item.location || '—'}</td>
                      <td className={`${TD} font-semibold`}>
                        {fmtNum(item.quantity, 0)} <span className="text-gray-400 text-xs">{item.uom}</span>
                      </td>
                      <td className={TD}>{fmtNum(item.pallet, 1)}</td>
                      <td className={TD}>
                        <span className="font-bold text-gray-900">{item.expiry_date ? new Date(item.expiry_date).getFullYear() : '—'}</span>
                      </td>
                      <td className={TD}>
                        <span className={`font-bold ${
                          item.days_remaining < 0 ? 'text-red-600' :
                          item.days_remaining <= 30 ? 'text-orange-600' :
                          item.days_remaining <= 90 ? 'text-amber-600' :
                          'text-emerald-600'
                        }`}>
                          {item.days_remaining < 0 ? `${Math.abs(item.days_remaining)}d ago` : `${item.days_remaining}d`}
                        </span>
                      </td>
                      <td className={TD}>
                        <button 
                          className="px-2.5 py-1 text-xs font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors"
                          onClick={() => {
                            // TODO: Implement quick pick action
                            alert(`Create pick for: ${item.product_name} (${item.batch_number})`);
                          }}
                        >
                          Pick Now
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* View More Button */}
            {queue.length > limit && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => {
                    setExpanded(!expanded);
                    if (!expanded) loadFefoQueue();
                  }}
                  className="px-4 py-2 text-sm font-semibold text-brand-600 hover:text-brand-700 hover:bg-brand-50 rounded-lg transition-colors"
                >
                  {expanded ? 'Show Less' : `View All ${queue.length} Items`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
