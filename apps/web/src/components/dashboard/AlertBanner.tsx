import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';

interface Alert {
  level: 'critical' | 'warning' | 'info';
  type: string;
  message: string;
  count: number;
  action_link?: string;
}

interface AlertBannerProps {
  alerts: Alert[];
}

export default function AlertBanner({ alerts }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (alerts.length === 0) return null;

  const visibleAlerts = alerts.filter((a) => !dismissed.has(a.type));
  if (visibleAlerts.length === 0) return null;

  const dismiss = (type: string) => {
    setDismissed(new Set([...dismissed, type]));
  };

  return (
    <div className="space-y-2 mb-5">
      {visibleAlerts.map((alert) => {
        const config = {
          critical: {
            bg: 'bg-red-50',
            border: 'border-red-200',
            text: 'text-red-800',
            icon: AlertTriangle,
            iconColor: 'text-red-600',
          },
          warning: {
            bg: 'bg-orange-50',
            border: 'border-orange-200',
            text: 'text-orange-800',
            icon: AlertCircle,
            iconColor: 'text-orange-600',
          },
          info: {
            bg: 'bg-blue-50',
            border: 'border-blue-200',
            text: 'text-blue-800',
            icon: Info,
            iconColor: 'text-blue-600',
          },
        }[alert.level];

        const Icon = config.icon;

        return (
          <div
            key={alert.type}
            className={`rounded-lg border ${config.border} ${config.bg} px-4 py-3 flex items-center justify-between`}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Icon className={`w-5 h-5 flex-shrink-0 ${config.iconColor}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${config.text}`}>{alert.message}</p>
              </div>
              {alert.action_link && (
                <Link
                  to={alert.action_link}
                  className={`text-xs font-bold px-3 py-1.5 rounded-md ${config.text} hover:bg-white/50 transition whitespace-nowrap`}
                >
                  Lihat Detail →
                </Link>
              )}
            </div>
            <button
              onClick={() => dismiss(alert.type)}
              className={`ml-3 p-1 rounded hover:bg-white/50 transition ${config.text}`}
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
