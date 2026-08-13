export function fmtNum(v: any, digits = 2): string {
  const n = Number(v ?? 0);
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return `${fmtDate(v)} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function expiryInfo(expiry: string | null | undefined): {
  text: string;
  level: 'ok' | 'warning' | 'critical' | 'expired' | 'none';
} {
  if (!expiry) return { text: 'No expiry', level: 'none' };
  const exp = new Date(expiry);
  const now = new Date();
  const ms = exp.getTime() - now.getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 0) return { text: `Expired ${Math.abs(days)}d ago`, level: 'expired' };
  if (days <= 120) return { text: `${days}d left`, level: 'critical' };
  if (days <= 180) return { text: `${days}d left`, level: 'warning' };
  const months = Math.floor(days / 30);
  return { text: `${months}m left`, level: 'ok' };
}

export function roleLabel(role: string): string {
  return (role || 'viewer').charAt(0).toUpperCase() + (role || 'viewer').slice(1);
}

export function money(v: any): string {
  return Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
