"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.todayStr = todayStr;
exports.todayCompact = todayCompact;
exports.nowCompactTime = nowCompactTime;
exports.nowDatetime = nowDatetime;
exports.monthCompact = monthCompact;
exports.addYears = addYears;
exports.parseDateLiteral = parseDateLiteral;
exports.daysUntil = daysUntil;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
function jakartaNow() {
    return new Date(Date.now() + JAKARTA_OFFSET_MS);
}
function pad(n, width = 2) {
    return String(n).padStart(width, '0');
}
function todayStr() {
    const d = jakartaNow();
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function todayCompact() {
    const d = jakartaNow();
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
function nowCompactTime() {
    const d = jakartaNow();
    return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
function nowDatetime() {
    const d = jakartaNow();
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function monthCompact() {
    const d = jakartaNow();
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`;
}
function addYears(date, years = 4) {
    if (!date)
        return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (!m)
        return null;
    const y = Number(m[1]) + years;
    const month = Number(m[2]);
    const maxDay = new Date(y, month, 0).getDate();
    const day = Math.min(Number(m[3]), maxDay);
    return `${y}-${pad(month)}-${pad(day)}`;
}
function parseDateLiteral(v) {
    if (v === null || v === undefined)
        return null;
    const s = String(v).trim();
    if (s === '' || s === '0')
        return null;
    const m = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(s);
    if (m)
        return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
}
function daysUntil(dateStr) {
    if (!dateStr)
        return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
    if (!m)
        return null;
    const expiryUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const todayUtc = jakartaNow();
    return Math.floor((expiryUtc - Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate())) / 86_400_000);
}
//# sourceMappingURL=date-util.js.map