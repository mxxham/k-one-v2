"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNumber = generateNumber;
exports.stockTakeNumber = stockTakeNumber;
exports.adjustmentReference = adjustmentReference;
exports.stockImportReference = stockImportReference;
const date_util_1 = require("./date-util");
async function generateNumber(db, spec) {
    const { table, column, searchPrefix, prefix, pad = 4 } = spec;
    const like = `${searchPrefix}%`;
    const q = await db.query(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE $1 ORDER BY ${column} DESC LIMIT 1`, [like]);
    let seq = 1;
    if (q.rows.length > 0) {
        const last = q.rows[0].v;
        const idx = last.lastIndexOf('-');
        const suffix = idx >= 0 ? last.slice(idx + 1) : last;
        const n = Number.parseInt(suffix, 10);
        if (!Number.isNaN(n))
            seq = n + 1;
    }
    for (let i = 0; i < 20; i++) {
        const candidate = `${prefix}${String(seq).padStart(pad, '0')}`;
        const exists = await db.query(`SELECT id FROM ${table} WHERE ${column} = $1 LIMIT 1`, [candidate]);
        if (exists.rows.length === 0)
            return candidate;
        seq++;
    }
    const rand = Math.floor(Math.random() * 90) + 10;
    return `${prefix}${(0, date_util_1.nowCompactTime)()}${rand}`;
}
function stockTakeNumber() {
    const rand = Math.floor(Math.random() * 10_000);
    return `ST-${(0, date_util_1.todayCompact)()}-${String(rand).padStart(4, '0')}`;
}
function adjustmentReference() {
    return `ADJ-${(0, date_util_1.todayCompact)()}${(0, date_util_1.nowCompactTime)()}`;
}
function stockImportReference(seq) {
    return `IST-${(0, date_util_1.todayCompact)()}-${String(seq).padStart(4, '0')}`;
}
//# sourceMappingURL=number-gen.js.map