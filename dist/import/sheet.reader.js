"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readSheetBuffer = readSheetBuffer;
exports.readWorkbookSheets = readWorkbookSheets;
const XLSX = __importStar(require("xlsx"));
function normalizeExt(name) {
    const m = /\.([^.]+)$/.exec(name || '');
    return (m ? m[1] : '').toLowerCase();
}
function readSheetBuffer(buffer, name) {
    const ext = normalizeExt(name);
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        throw new Error('Format file harus .xlsx, .xls, atau .csv');
    }
    if (ext === 'csv') {
        const text = buffer.toString('utf8');
        const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
        return parseCsv(clean);
    }
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws)
        return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}
function readWorkbookSheets(buffer, name) {
    const ext = normalizeExt(name);
    if (!['xlsx', 'xls'].includes(ext)) {
        throw new Error('Format file harus .xlsx atau .xls');
    }
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const out = [];
    for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        out.push({ name: sheetName, rows });
    }
    return out;
}
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const pushField = () => {
        row.push(field);
        field = '';
    };
    while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += ch;
            i++;
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
            i++;
            continue;
        }
        if (ch === ',') {
            pushField();
            i++;
            continue;
        }
        if (ch === '\n') {
            pushField();
            rows.push(row);
            row = [];
            i++;
            continue;
        }
        if (ch === '\r') {
            i++;
            continue;
        }
        field += ch;
        i++;
    }
    pushField();
    if (row.length > 0 || rows.length === 0)
        rows.push(row);
    return rows;
}
//# sourceMappingURL=sheet.reader.js.map