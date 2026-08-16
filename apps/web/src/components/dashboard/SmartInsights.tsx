import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, MapPin, Package } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtNum, fmtDate } from '@/lib/format';
import { Link } from 'react-router-dom';
import Spinner from '@/components/Spinner';
import { EmptyState } from '@/components/Card';

interface FastMover {
  id: number;
  product_code: string;
  product_name: string;
  transaction_count: number;
  total_shipped: number;
  avg_daily_qty: number;
}

interface SlowMover {
  id: number;
  product_code: string;
  product_name: string;
  batch_count: number;
  total_qty: number;
  oldest_receipt: string;
}

interface LowStock {
  id: number;
  product_code: string;
  product_name: string;
  uom_type: string;
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

export default function SmartInsights() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadInsights();
  }, []);

  const loadInsights = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api('dashboard', 'insights');
      setData({
        fast_movers: res.fast_movers || [],
        slow_movers: res.slow_movers || [],
        low_stock: res.low_stock || [],
        location_utilization: res.location_utilization || [],
      });
    } catch (e: any) {
      setError(e.message || 'Gagal memuat insights');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <Spinner label="Loading..." />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <Spinner label="Loading..." />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <Spinner label="Loading..." />
        </div>
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Fast Movers */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-500 p-4 text-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Fast Movers</h3>
              <p className="text-emerald-100 text-[10px]">Top 5 by volume (30 days)</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          {data.fast_movers.length === 0 ? (
            <EmptyState message="No data available" />
          ) : (
            <div className="space-y-3">
              {data.fast_movers.map((item, idx) => (
                <div key={item.id} className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold flex-shrink-0">
                        {idx + 1}
                      </span>
                      <Link 
                        to={`/stock?q=${encodeURIComponent(item.product_code)}`}
                        className="font-semibold text-sm text-gray-900 hover:text-brand-600 truncate"
                      >
                        {item.product_name}
                      </Link>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5 ml-7">
                      {item.product_code} • {item.transaction_count} transactions
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-emerald-600 text-sm">{fmtNum(item.total_shipped, 0)}</div>
                    <div className="text-[10px] text-gray-500">{fmtNum(item.avg_daily_qty, 1)}/day</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Slow Movers */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-gradient-to-br from-amber-600 to-amber-500 p-4 text-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <TrendingDown className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Slow Movers</h3>
              <p className="text-amber-100 text-[10px]">Stock aged 90+ days</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          {data.slow_movers.length === 0 ? (
            <EmptyState message="No aged inventory" />
          ) : (
            <div className="space-y-3">
              {data.slow_movers.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <Link 
                      to={`/stock?q=${encodeURIComponent(item.product_code)}`}
                      className="font-semibold text-sm text-gray-900 hover:text-brand-600 block truncate"
                    >
                      {item.product_name}
                    </Link>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {item.product_code} • {item.batch_count} batch{item.batch_count > 1 ? 'es' : ''}
                    </div>
                    {item.oldest_receipt && (
                      <div className="text-[10px] text-amber-600 font-medium mt-1">
                        Since {fmtDate(item.oldest_receipt)}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-amber-600 text-sm">{fmtNum(item.total_qty, 0)}</div>
                    <div className="text-[10px] text-gray-500">units</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Location Utilization */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-500 p-4 text-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Location Utilization</h3>
              <p className="text-blue-100 text-[10px]">Warehouse capacity by aisle</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          {data.location_utilization.length === 0 ? (
            <EmptyState message="No location data" />
          ) : (
            <div className="space-y-3">
              {data.location_utilization.map((loc) => {
                const pct = loc.utilization_percent;
                const color = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : pct >= 50 ? 'bg-blue-500' : 'bg-emerald-500';
                const textColor = pct >= 90 ? 'text-red-600' : pct >= 75 ? 'text-amber-600' : pct >= 50 ? 'text-blue-600' : 'text-emerald-600';
                
                return (
                  <div key={loc.aisle}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-semibold text-sm text-gray-900">Aisle {loc.aisle}</div>
                      <div className={`font-bold text-sm ${textColor}`}>{pct.toFixed(1)}%</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div 
                          className={`h-full ${color} transition-all duration-300`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-gray-500 flex-shrink-0">
                        {loc.occupied}/{loc.total_locations}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
