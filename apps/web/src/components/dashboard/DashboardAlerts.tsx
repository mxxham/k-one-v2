import { useEffect, useState } from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Link } from 'react-router-dom';

interface Alert {
  level: 'critical' | 'warning' | 'info';
  type: string;
  message: string;
  count: number;
  action_link?: string;
}

interface AlertsData {
  alerts: Alert[];
}

function alertIcon(level: string) {
  switch (level) {
    case 'critical': return AlertTriangle;
    case 'warning': return AlertCircle;
    case 'info': return Info;
    default: return Info;
  }
}

function alertStyle(level: string) {
  switch (level) {
    case 'critical': return 'bg-red-50 border-red-300 text-red-800';
    case 'warning': return 'bg-orange-50 border-orange-300 text-orange-800';
    case 'info': return 'bg-blue-50 border-blue-300 text-blue-800';
    default: return 'bg-gray-50 border-gray-300 text-gray-800';
  }
}

function alertBadgeStyle(level: string) {
  switch (level) {
    case 'critical': return 'bg-red-600 text-white';
    case 'warning': return 'bg-orange-600 text-white';
    case 'info': return 'bg-blue-600 text-white';
    default: return 'bg-gray-600 text-white';
  }
}

export default function DashboardAlerts() {
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const res = await api('dashboard', 'alerts');
      setData({ alerts: res.alerts || [] });
    } catch (e: any) {
      console.error('Failed to load alerts:', e);
    } finally {
      setLoading(false);
    }
  };

  const dismissAlert = (type: string) => {
    setDismissed(new Set([...dismissed, type]));
  };

  if (loading || !data) return null;

  const visibleAlerts = data.alerts.filter(a => !dismissed.has(a.type));

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="space-y-2 mb-5">
      {visibleAlerts.map((alert) => {
        const Icon = alertIcon(alert.level);
        const style = alertStyle(alert.level);
        const badgeStyle = alertBadgeStyle(alert.level);

        return (
          <div 
            key={alert.type}
            className={`rounded-lg border px-4 py-3 flex items-center justify-between gap-4 ${style} shadow-sm`}
          >
            <div className="flex items-center gap-3 flex-1">
              <Icon className="w-5 h-5 flex-shrink-0" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold ${badgeStyle}`}>
                  {alert.count}
                </span>
                <span className="font-semibold text-sm">{alert.message}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {alert.action_link && (
                <Link
                  to={alert.action_link}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-white/80 hover:bg-white border border-current/20 transition-colors"
                >
                  View
                </Link>
              )}
              <button
                onClick={() => dismissAlert(alert.type)}
                className="p-1 rounded hover:bg-black/10 transition-colors"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
