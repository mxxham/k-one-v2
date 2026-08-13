import { ReactNode } from 'react';
import { Printer } from 'lucide-react';

/**
 * Link that opens a binary API endpoint (print document / Excel export) in a
 * new tab. These endpoints authenticate via the token query param appended by
 * apiHref().
 */
export function WebBtn({
  href,
  label,
  icon = <Printer className="w-4 h-4" />,
  tone = 'dark',
  className = '',
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  tone?: 'dark' | 'brand' | 'green';
  className?: string;
}) {
  const base = {
    dark: 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 border border-white/25 text-white text-sm font-semibold hover:bg-white/20',
    brand: 'inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 hover:bg-brand-100 rounded-lg px-3 py-1.5',
    green: 'inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5',
  }[tone];
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${base} ${className}`}>
      {icon}
      {label}
    </a>
  );
}