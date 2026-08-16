import { DragEvent, ReactNode, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Truck, PackageOpen, Boxes, Download, UploadCloud, RefreshCw,
  CheckCircle2, AlertTriangle, XCircle, X, FileCheck2, PlayCircle,
} from 'lucide-react';
import { api, apiHref, uploadApi } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';

import { Field, TextInput, Select } from '@/components/Field';
import { fmtNum, fmtDate } from '@/lib/format';

type TabKey = 'inbound' | 'outbound' | 'stock';

interface StockRow {
  product_code: string;
  product_name?: string;
  batch_number?: string;
  location?: string;
  quantity: number;
  uom?: string;
  pallet?: number;
  manufacture_date?: string | null;
  expiry_date?: string | null;
  stock_status?: string;
  notes?: string;
  _row_num?: number;
  _errors?: string[];
  _warnings?: string[];
}

interface ImportResult {
  message?: string;
  processed?: number;
  stats?: Record<string, any>;
  errors?: string[];
  log?: string[];
  has_errors?: boolean;
}

const TABS: { key: TabKey; label: string; icon: typeof Truck; blurb: string }[] = [
  { key: 'inbound', label: 'Import Inbound', icon: Truck, blurb: 'Bulk inbound orders dari Excel (.xlsx / .xls / .csv)' },
  { key: 'outbound', label: 'Import Outbound', icon: PackageOpen, blurb: 'Planning outbound (1 shipment = 1 order)' },
  { key: 'stock', label: 'Import Stock', icon: Boxes, blurb: 'Opening balance / stok awal per batch & lokasi' },
];

const STOCK_MODES = [
  { value: 'add', label: 'Add — tambah qty ke stok yang sama' },
  { value: 'replace', label: 'Replace — timpa qty stok yang sama' },
  { value: 'skip', label: 'Skip — lewati stok yang sudah ada' },
];

function InlineSpinner() {
  return <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />;
}

function StatCard({ label, value, tone = 'brand' }: { label: string; value: ReactNode; tone?: 'brand' | 'warn' | 'red' | 'green' }) {
  const bg = {
    brand: 'bg-brand-50 text-brand-800',
    warn: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
    green: 'bg-emerald-50 text-emerald-700',
  }[tone];
  return (
    <div className={`rounded-xl ${bg} p-4 text-center`}>
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70 mt-0.5">{label}</div>
    </div>
  );
}

function FilePicker({ file, onFile, onClear, icon: Icon }: { file: File | null; onFile: (f: File) => void; onClear: () => void; icon: typeof Truck }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const accept = '.xlsx,.xls,.csv';

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  return (
    <div>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {!file ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={drop}
          className={`cursor-pointer border-3 border-dashed rounded-2xl py-14 text-center transition-colors ${
            drag ? 'border-indigo-400 bg-indigo-50/60' : 'border-brand-300 bg-brand-50/40 hover:bg-brand-50'
          }`}
        >
          <Icon className="w-12 h-12 text-brand-600 mx-auto mb-3" strokeWidth={1.4} />
          <p className="text-sm font-semibold text-gray-600">Drag & drop file Excel, atau klik untuk pilih</p>
          <p className="text-xs text-gray-400 mt-1">Format: .xlsx, .xls, atau .csv</p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <FileCheck2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-800 truncate">{file.name}</div>
              <div className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</div>
            </div>
          </div>
          <button onClick={onClear} className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900 flex-shrink-0">
            <X className="w-3.5 h-3.5" /> Hapus
          </button>
        </div>
      )}
    </div>
  );
}

function ResultStats({ result }: { result: ImportResult }) {
  const s = result.stats || {};
  const itemsTone = result.has_errors ? 'red' : 'green';
  const errN = (result.errors?.length ?? 0) || Number(s.errors ?? 0);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <StatCard label="Items Diimport" value={fmtNum(s.items_imported ?? result.processed ?? 0, 0)} tone={itemsTone} />
      <StatCard label="Rows Dilewati" value={fmtNum(s.rows_skipped ?? 0, 0)} tone="warn" />
      <StatCard label="Orders Dibuat" value={fmtNum(s.orders_created ?? '-', 0)} tone="brand" />
      <StatCard label="Warnings/Errors" value={errN} tone={errN > 0 ? 'red' : 'brand'} />
    </div>
  );
}

function ResultLog({ result }: { result: ImportResult }) {
  const lines = result.log?.length ? result.log : result.errors?.length ? result.errors : null;
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-100/80 border-b border-gray-200 text-[11px] font-bold uppercase tracking-wide text-gray-500">
        {result.log?.length ? 'Log Import' : 'Errors / Warnings'}
      </div>
      <div className="max-h-64 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed text-gray-700 divide-y divide-gray-100">
        {lines ? (
          lines.map((l, i) => (
            <div key={i} className={`py-1 ${l.toLowerCase().includes('error') || l.toLowerCase().includes('skipped') || l.toLowerCase().includes('tidak') ? 'text-red-600' : 'text-gray-700'}`}>
              {l}
            </div>
          ))
        ) : (
          <div className="text-gray-400">Tidak ada catatan.</div>
        )}
      </div>
    </div>
  );
}

export default function ImportPage() {
  const [tab, setTab] = useState<TabKey>('inbound');
  const [file, setFile] = useState<File | null>(null);
  const [carrier, setCarrier] = useState('');
  const [skipUnknown, setSkipUnknown] = useState(false);
  const [groupByShipment, setGroupByShipment] = useState(true);
  const [mode, setMode] = useState('add');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<StockRow[] | null>(null);
  const [previewStats, setPreviewStats] = useState<any>(null);
  const [commitResult, setCommitResult] = useState<ImportResult | null>(null);

  const cfg = TABS.find((t) => t.key === tab)!;
  const templateAction = { inbound: 'tpl_inbound', outbound: 'tpl_outbound', stock: 'tpl_stock' }[tab];
  const tplHref = apiHref('import', templateAction);

  const invalidRaws = preview?.filter((r) => (r._errors?.length) ?? false).length ?? 0;
  const validRaws = preview ? preview.length - invalidRaws : 0;

  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    setResult(null);
    setCommitResult(null);
    const fd = new FormData();
    fd.append('excel_file', file, file.name);
    if (tab === 'inbound') fd.append('carrier_name', carrier.trim());
    if (tab === 'outbound') {
      fd.append('skip_unknown', skipUnknown ? '1' : '');
      fd.append('group_by_shipment', groupByShipment ? '1' : '');
    }
    try {
      if (tab === 'stock') {
        const res = await uploadApi('import', 'stock_preview', fd);
        setPreview((res.rows || []) as StockRow[]);
        setPreviewStats(res.stats || null);
        setResult({ message: res.message });
      } else {
        const res = await uploadApi('import', tab === 'inbound' ? 'inbound' : 'outbound', fd);
        setResult(res as ImportResult);
      }
    } catch (e: any) {
      setError(e.message || 'Gagal memproses file');
    } finally {
      setBusy(false);
    }
  };

  const commitStock = async () => {
    setBusy(true);
    setError('');
    setCommitResult(null);
    try {
      const res = await api('import', 'stock_commit', { method: 'POST', body: { rows: preview, mode } });
      setCommitResult(res as ImportResult);
    } catch (e: any) {
      setError(e.message || 'Gagal commit stok');
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setFile(null);
    setCarrier('');
    setResult(null);
    setPreview(null);
    setPreviewStats(null);
    setCommitResult(null);
    setError('');
  };

  return (
    <div>
      <PageHeader
        title="Import Excel"
        subtitle={cfg.blurb}
        actions={
          <Link to={tab === 'stock' ? '/stock' : tab === 'outbound' ? '/outbound' : '/inbound'}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 border border-white/30 text-white text-sm font-semibold hover:bg-white/25">
            Back
          </Link>
        }
      />

      <div className="rounded-xl bg-white border border-gray-200 shadow-sm mb-5 overflow-x-auto">
        <div className="flex gap-1 p-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === t.key ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-500 hover:bg-brand-50 hover:text-brand-700'
              }`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200 flex items-start gap-2">
          <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {tab === 'stock' && preview ? (
        <StockPreviewTab
          rows={preview}
          stats={previewStats}
          mode={mode}
          setMode={setMode}
          validRaws={validRaws}
          invalidRaws={invalidRaws}
          busy={busy}
          onCommit={commitStock}
          commitResult={commitResult}
          onBack={resetAll}
          onPreviewOpen={() => { setPreview(null); setFile(null); }}
        />
      ) : (
        <>
          <Card title="Template Excel">
            <p className="text-sm text-gray-500 mb-3">Download template terlebih dahulu sebagai panduan kolom & contoh pengisian.</p>
            <a
              href={tplHref}
              download
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
            >
              <Download className="w-4 h-4" /> Download Template
            </a>
          </Card>

          <Card title="Upload & Import">
            <div className="space-y-4">
              {tab === 'inbound' && (
                <>
                  <Field label="Carrier / Transporter" className="max-w-xl">
                    <TextInput value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="e.g. PT Maju Jaya Logistics" />
                  </Field>
                  <p className="text-xs text-gray-400">Auto-deteksi format export WMS asli (kolom: Item / SKU, Qty, GR date, Expired Date, Batch, Lokasi). Baris dengan GR date sama digabung jadi 1 inbound order. Produk yang belum terdaftar dibuat otomatis.</p>
                </>
              )}

              {tab === 'outbound' && (
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={skipUnknown} onChange={(e) => setSkipUnknown(e.target.checked)} className="w-4 h-4 accent-brand-600" />
                    Lewati material yang tidak dikenal (skip_unknown)
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={groupByShipment} onChange={(e) => setGroupByShipment(e.target.checked)} className="w-4 h-4 accent-brand-600" />
                    Group per shipment number
                  </label>
                </div>
              )}

              {tab === 'stock' && (
                <>
                  <Field label="Mode Penggabungan Stok" className="max-w-xl">
                    <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                      {STOCK_MODES.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <p className="text-xs text-gray-400">Auto-deteksi format export WMS asli (kolom: Item / SKU, on hand, Lokasi, Batch, GR date, Expired Date, uom, status). Qty diambil dari kolom 'on hand' bila ada, fallback ke 'Qty'. Produk & lokasi yang belum terdaftar akan dibuat otomatis saat commit.</p>
                </>
              )}

              <FilePicker file={file} onFile={setFile} onClear={() => setFile(null)} icon={cfg.icon} />

              <button
                onClick={runImport}
                disabled={!file || busy}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-br from-brand-700 to-brand-600 text-white text-sm font-bold hover:from-brand-800 hover:to-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {busy ? <InlineSpinner /> : <UploadCloud className="w-4 h-4" />}
                {busy ? 'Memproses...' : tab === 'stock' ? 'Preview Data' : 'Upload & Import'}
              </button>
            </div>
          </Card>

          {result && (tab === 'inbound' || tab === 'outbound') && (
            <Card title="Hasil Import" actions={
              <button onClick={resetAll} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Import Lagi
              </button>
            }>
              <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-semibold border flex items-center gap-2 ${
                result.has_errors ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {result.has_errors ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {result.message}
              </div>
              <ResultStats result={result} />
              <ResultLog result={result} />
            </Card>
          )}

          {tab === 'stock' && result && !preview && (
            <Card title="Hasil Preview" actions={
              <button onClick={resetAll} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Upload Ulang
              </button>
            }>
              <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-semibold border border-emerald-200">
                <CheckCircle2 className="inline w-4 h-4 mr-1.5" /> {result.message}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total Baris" value={fmtNum(previewStats?.total_rows ?? 0, 0)} tone="brand" />
                <StatCard label="Baris Valid" value={fmtNum(validRaws, 0)} tone="green" />
                <StatCard label="Baris Error" value={fmtNum(invalidRaws, 0)} tone={invalidRaws > 0 ? 'red' : 'green'} />
                <StatCard label="Mode" value={mode} tone="warn" />
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StockPreviewTab({
  rows, stats, mode, setMode, validRaws, invalidRaws, busy, onCommit, commitResult, onBack, onPreviewOpen,
}: {
  rows: StockRow[];
  stats: any;
  mode: string;
  setMode: (m: string) => void;
  validRaws: number;
  invalidRaws: number;
  busy: boolean;
  onCommit: () => void;
  commitResult: ImportResult | null;
  onBack: () => void;
  onPreviewOpen: () => void;
}) {
  return (
    <>
      <Card
        title="Preview & Validasi Stok"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={onPreviewOpen} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg px-3 py-1.5 border border-brand-200">
              Upload Ulang
            </button>
            <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5">
              <X className="w-3.5 h-3.5" /> Batal
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total Baris" value={fmtNum(stats?.total_rows ?? rows.length, 0)} tone="brand" />
          <StatCard label="Baris Valid" value={fmtNum(validRaws, 0)} tone="green" />
          <StatCard label="Baris Error" value={fmtNum(invalidRaws, 0)} tone={invalidRaws > 0 ? 'red' : 'green'} />
          <StatCard label="Mode" value={mode} tone="warn" />
        </div>

        {invalidRaws > 0 && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 text-amber-800 text-sm border border-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {invalidRaws} baris gagal validasi dan akan dilewati saat commit. Produk yang belum ada akan dibuat otomatis (tanda peringatan).
          </div>
        )}

        <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-brand-50 sticky top-0">
              <tr className="text-left text-[10px] uppercase tracking-wide text-brand-700">
                <th className="px-3 py-2 font-bold">#</th>
                <th className="px-3 py-2 font-bold">Kode</th>
                <th className="px-3 py-2 font-bold">Produk</th>
                <th className="px-3 py-2 font-bold">Batch</th>
                <th className="px-3 py-2 font-bold">Lokasi</th>
                <th className="px-3 py-2 font-bold text-right">Qty</th>
                <th className="px-3 py-2 font-bold">UOM</th>
                <th className="px-3 py-2 font-bold text-right">Pallet</th>
                <th className="px-3 py-2 font-bold">Expiry</th>
                <th className="px-3 py-2 font-bold">Status</th>
                <th className="px-3 py-2 font-bold">Validasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => {
                const errs = r._errors || [];
                const warns = r._warnings || [];
                return (
                  <tr key={i} className={errs.length ? 'bg-red-50/50' : warns.length ? 'bg-amber-50/40' : 'hover:bg-brand-50'}>
                    <td className="px-3 py-2 text-gray-400 text-xs">{r._row_num ?? i + 1}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-brand-700">{r.product_code}</td>
                    <td className="px-3 py-2 text-gray-700">{r.product_name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.batch_number || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.location || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtNum(r.quantity, 0)}</td>
                    <td className="px-3 py-2 text-gray-600">{r.uom}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{fmtNum(r.pallet, 0)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{fmtDate(r.expiry_date)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{r.stock_status}</td>
                    <td className="px-3 py-2">
                      {errs.map((e, k) => (
                        <div key={k} className="text-[11px] text-red-600 flex items-center gap-1"><XCircle className="w-3 h-3 flex-shrink-0" />{e}</div>
                      ))}
                      {warns.map((w, k) => (
                        <div key={k} className="text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3 flex-shrink-0" />{w}</div>
                      ))}
                      {!errs.length && !warns.length && <span className="text-[11px] text-emerald-600 font-semibold">OK</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {commitResult && (
          <div className={`mt-4 px-4 py-3 rounded-lg text-sm font-semibold border flex items-center gap-2 ${
            (commitResult.stats?.skipped ?? 0) > 0 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {commitResult.stats?.skipped ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {commitResult.message}
          </div>
        )}
      </Card>

      {!commitResult && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="max-w-md">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              {STOCK_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </Select>
          </div>
          <button
            onClick={onCommit}
            disabled={busy || validRaws === 0}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-br from-emerald-600 to-green-600 text-white text-sm font-bold hover:from-emerald-700 hover:to-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0"
          >
            {busy ? <InlineSpinner /> : <PlayCircle className="w-4 h-4" />}
            {busy ? 'Menyimpan...' : `Commit ${validRaws} baris stok`}
          </button>
        </div>
      )}
    </>
  );
}