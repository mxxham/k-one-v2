import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { fmtNum } from '@/lib/format';

interface KPICardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  gradient: string;
  trend?: number; // Percentage change
  unit?: string;
}

export default function KPICard({ label, value, subtitle, icon: Icon, gradient, trend, unit }: KPICardProps) {
  const getTrendIcon = () => {
    if (trend === undefined || trend === 0) return Minus;
    return trend > 0 ? TrendingUp : TrendingDown;
  };

  const getTrendColor = () => {
    if (trend === undefined || trend === 0) return 'text-white/60';
    // For most metrics, up is good. For expired/aging, down is good.
    // We'll keep it simple: green for positive, red for negative
    return trend > 0 ? 'text-emerald-200' : 'text-red-200';
  };

  const TrendIcon = getTrendIcon();
  const trendColor = getTrendColor();

  return (
    <div className={`rounded-xl bg-gradient-to-br ${gradient} p-4 text-white shadow-sm relative overflow-hidden`}>
      {/* Background decoration */}
      <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
      
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <Icon className="w-4 h-4 opacity-80" />
          {trend !== undefined && (
            <div className={`flex items-center gap-0.5 text-xs font-bold ${trendColor}`}>
              <TrendIcon className="w-3 h-3" />
              <span>{Math.abs(trend).toFixed(1)}%</span>
            </div>
          )}
        </div>

        <div className="text-2xl font-extrabold">
          {typeof value === 'number' ? fmtNum(value, 0) : value}
          {unit && <span className="text-base font-semibold ml-1 opacity-80">{unit}</span>}
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">
          {label}
        </div>

        {subtitle && (
          <div className="text-xs opacity-75 mt-2">{subtitle}</div>
        )}
      </div>
    </div>
  );
}
