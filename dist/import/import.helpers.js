"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASTER_PRODUCT_CODE_KEYS = exports.SHIP_TO_LOC_KEYS = exports.SHIP_TO_NAME_KEYS = void 0;
exports.importParseDate = importParseDate;
exports.importNormalizeUom = importNormalizeUom;
exports.importUomPerPallet = importUomPerPallet;
exports.importHeaderIndex = importHeaderIndex;
exports.importResolveCol = importResolveCol;
exports.importDetectHeader = importDetectHeader;
exports.importGetter = importGetter;
exports.importIsMetaRow = importIsMetaRow;
function importParseDate(val) {
    if (val === null || val === undefined)
        return null;
    const s = String(val).trim();
    if (s === '' || s === '0')
        return null;
    if (typeof val === 'number' && val > 40000) {
        try {
            const dt = excelSerialToDate(val);
            const y = dt.getUTCFullYear();
            if (y < 1990 || y > 2100)
                return null;
            return dt.toISOString().slice(0, 10);
        }
        catch {
        }
    }
    if (typeof val === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(val))
            return val;
        let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(val);
        if (m) {
            const d = Number(m[1]);
            const mo = Number(m[2]);
            const y = Number(m[3]);
            if (d > 12 && mo <= 12)
                return `${p4(y)}-${p2(mo)}-${p2(d)}`;
            if (mo > 12 && d <= 12)
                return `${p4(y)}-${p2(d)}-${p2(mo)}`;
            return `${p4(y)}-${p2(mo)}-${p2(d)}`;
        }
        m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(val);
        if (m)
            return `${p4(Number(m[3]))}-${p2(Number(m[2]))}-${p2(Number(m[1]))}`;
    }
    const ts = Date.parse(val);
    if (!Number.isNaN(ts) && ts > 0) {
        const d = new Date(ts);
        const y = d.getUTCFullYear();
        if (y >= 1990 && y <= 2100)
            return d.toISOString().slice(0, 10);
    }
    return null;
}
function excelSerialToDate(serial) {
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function p2(n) {
    return String(n).padStart(2, '0');
}
function p4(n) {
    return String(n).padStart(4, '0');
}
const UOM_MAP = {
    car: 'Carton', ctn: 'Carton', carton: 'Carton',
    drm: 'Drum', drum: 'Drum',
    pail: 'Pail', pal: 'Pail',
    bag: 'Bags', bags: 'Bags',
    ea: 'EA', each: 'EA', pcs: 'EA',
};
function importNormalizeUom(raw, fallback = 'Drum') {
    const k = String(raw ?? '').trim().toLowerCase();
    return UOM_MAP[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1) : fallback);
}
function importUomPerPallet(uom, productUpp = 4) {
    switch (String(uom).trim().toLowerCase()) {
        case 'drum': return 4;
        case 'carton': return Math.max(1, productUpp || 44);
        case 'pail': return 24;
        case 'bags': return 1;
        case 'ea': return 4;
        default: return Math.max(1, productUpp || 4);
    }
}
function importHeaderIndex(row) {
    const map = {};
    for (let i = 0; i < row.length; i++) {
        const key = String(row[i] ?? '').trim().replace(/^\s*\*\s*/, '').toLowerCase();
        if (key !== '')
            map[key] = i;
    }
    return map;
}
function importResolveCol(headers, patterns) {
    let best = null;
    let bestPri = Infinity;
    let bestExact = false;
    for (let pri = 0; pri < patterns.length; pri++) {
        const p = String(patterns[pri]).trim().toLowerCase();
        if (p === '')
            continue;
        for (let ci = 0; ci < headers.length; ci++) {
            const hl = String(headers[ci] ?? '').trim().toLowerCase();
            if (hl === '')
                continue;
            const exact = hl === p;
            if (exact || hl.includes(p)) {
                if (pri < bestPri || (pri === bestPri && exact && !bestExact)) {
                    best = ci;
                    bestPri = pri;
                    bestExact = exact;
                }
            }
        }
    }
    return best;
}
const HEADER_KEYWORDS = [
    'product', 'qty', 'batch', 'item', 'lokasi', 'location', 'on hand', 'uom', 'unit',
    'shipment', 'material', 'sku', 'expiry', 'exp date', 'expired date', 'gr date',
    'quantity', 'actual qty', 'volume', 'batch no',
];
function importDetectHeader(allRows) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let idx = 0; idx < allRows.length; idx++) {
        const rowStr = allRows[idx].map((v) => String(v ?? '')).join(' ').toLowerCase();
        let score = 0;
        for (const kw of HEADER_KEYWORDS)
            if (rowStr.includes(kw))
                score++;
        if (score > bestScore) {
            bestScore = score;
            bestIdx = idx;
        }
    }
    if (bestScore < 1)
        bestIdx = 0;
    return { index: bestIdx, row: allRows[bestIdx] };
}
exports.SHIP_TO_NAME_KEYS = [
    'name of ship-to party', 'name of the ship-to party', 'ship-to party',
    'ship to name', 'ship-to name', 'destination',
];
exports.SHIP_TO_LOC_KEYS = [
    'location of ship-to party', 'location of the ship-to party',
    'ship to location', 'ship-to location', 'destination',
];
exports.MASTER_PRODUCT_CODE_KEYS = [
    'material', 'item', 'item code', 'product code', 'sku', 'code',
];
function importGetter(colMap, row) {
    return (...keys) => {
        for (const key of keys) {
            const k = String(key).trim().toLowerCase();
            if (k in colMap) {
                const v = String(row[colMap[k]] ?? '').trim();
                if (v !== '' && v !== '0')
                    return v;
            }
        }
        return '';
    };
}
const META_KEYWORDS = ['kolom', 'values', 'format', 'uraian', 'petunjuk', 'note', '* nama'];
function importIsMetaRow(row) {
    const first = String(row[0] ?? '').trim();
    if (first === '' || first.startsWith('*'))
        return true;
    const lower = first.toLowerCase();
    for (const kw of META_KEYWORDS)
        if (lower.includes(kw))
            return true;
    return false;
}
//# sourceMappingURL=import.helpers.js.map