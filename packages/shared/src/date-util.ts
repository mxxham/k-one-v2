/**
 * Date utilities mirroring PHP Asia/Jakarta behavior. Shared by API + worker.
 */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

function jakartaNow(): Date {
  return new Date(Date.now() + JAKARTA_OFFSET_MS);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** PHP date('Y-m-d') in Asia/Jakarta. */
export function todayStr(): string {
  const d = jakartaNow();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function todayCompact(): string {
  const d = jakartaNow();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export function nowCompactTime(): string {
  const d = jakartaNow();
  return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export function nowDatetime(): string {
  const d = jakartaNow();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** PHP date('Y-m') e.g. 2026-08 */
export function monthCompact(): string {
  const d = jakartaNow();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`;
}

/** +{years} years on a Y-m-d date. */
export function addYears(date: string, years = 4): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const y = Number(m[1]) + years;
  const month = Number(m[2]);
  const maxDay = new Date(y, month, 0).getDate();
  const day = Math.min(Number(m[3]), maxDay);
  return `${y}-${pad(month)}-${pad(day)}`;
}

export function parseDateLiteral(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '0') return null;
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!m) return null;
  const expiryUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const todayUtc = jakartaNow();
  return Math.floor((expiryUtc - Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate())) / 86_400_000);
}