import { TrendingUp, TrendingDown, AlertCircle, BarChart3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fmtNum } from '@/lib/format';

interface FastMover {
  id: number;
  product_code: string;
  product_name: string;
  total_shipped: number;
  avg_daily_qty: number;
}

interface SlowMover {
  id: number;
  product_code: string;
  product_name: string;
  batch_count: number;
  total_qty: number;
  oldest_receipt: string | null;
}

interface LowStock {
  id: number;
  product_code: string;
  product_name: string;
  current_qty: number;
  reorder_point: number;
}

interface LocationUtil {
  aisle: string;
  total_locations: number;
  occupied: number;
  utilization_percent: number;
}

interface InsightsData {
  fast_movers: FastMover[];
  slow_movers: SlowMover[];
  low_stock: LowStock[];
  location_utilization: LocationUtil[];
}

interface InsightCardsProps {
  data: InsightsData;
  loading?: boolean;
}

export default function InsightCards({ data, loading }: InsightCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/2 mb-4" />
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded" />
              <div className="h-4 bg-gray-200 rounded w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Fast Movers */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 hover:shadow-md transition">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-emerald-700">
            <TrendingUp className="w-5 h-5" />
            <h3 className="font-bold text-sm">Fast Movers</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Last 30 Days</span>
        </div>

        {data.fast_movers.length === 0 ? (
          <p className="text-sm text-gray-500">No data available</p>
        ) : (
          <div className="space-y-3">
            {data.fast_movers.map((item, idx) => (
              <div key={item.id} className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{item.product_code}</div>
                  <div className="text-[11px] text-gray-600">
                    {fmtNum(item.total_shipped, 0)} shipped • {fmtNum(item.avg_daily_qty, 1)}/day
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Link
          to="/stock?sort=turnover"
          className="mt-4 block text-center text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
        >
          View All →
        </Link>
      </div>

      {/* Slow Movers */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 hover:shadow-md transition">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-amber-700">
            <TrendingDown className="w-5 h-5" />
            <h3 className="font-bold text-sm">Slow Movers</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600">90+ Days</span>
        </div>

        {data.slow_movers.length === 0 ? (
          <p className="text-sm text-gray-500">No aging inventory</p>
        ) : (
          <div className="space-y-3">
            {data.slow_movers.map((item) => (
              <div key={item.id} className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{item.product_code}</div>
                  <div className="text-[11px] text-gray-600">
                    {fmtNum(item.total_qty, 0)} units • {item.batch_count} batch{item.batch_count !== 1 ? 'es' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Link
          to="/stock?filter=aging"
          className="mt-4 block text-center text-xs font-semibold text-amber-700 hover:text-amber-800 hover:underline"
        >
          View All →
        </Link>
      </div>

      {/* Location Utilization */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5 hover:shadow-md transition">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-blue-700">
            <BarChart3 className="w-5 h-5" />
            <h3 className="font-bold text-sm">Location Utilization</h3>
          </div>
        </div>

        {data.location_utilization.length === 0 ? (
          <p className="text-sm text-gray-500">No location data</p>
        ) : (
          <div className="space-y-3">
            {data.location_utilization.slice(0, 5).map((loc) => (
              <div key={loc.aisle}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-gray-900">Aisle {loc.aisle}</span>
                  <span className="text-xs font-bold text-blue-700">{loc.utilization_percent.toFixed(1)}%</span>
                </div>
                <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                      loc.utilization_percent >= 90
                        ? 'bg-red-500'
                        : loc.utilization_percent >= 75
                          ? 'bg-amber-500'
                          : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(loc.utilization_percent, 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {loc.occupied}/{loc.total_locations} locations
                </div>
              </div>
            ))}
          </div>
        )}

        <Link
          to="/locations"
          className="mt-4 block text-center text-xs font-semibold text-blue-700 hover:text-blue-800 hover:underline"
        >
          View All Locations →
        </Link>
      </div>
    </div>
  );
}
