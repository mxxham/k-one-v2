import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, FileText, CalendarDays, Box, Truck, PackageOpen, Boxes, BookOpen,
  ArrowDownToLine, ArrowUpFromLine, PackagePlus, PackageMinus, Printer, FileSpreadsheet,
} from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import Spinner from '@/components/Spinner';
import StatusBadge from '@/components/StatusBadge';
import { Field, TextInput } from '@/components/Field';
import { fmtNum, fmtDate, todayISO, expiryInfo } from '@/lib/format';

interface Col {
  key: string;
  label: string;
  render?: (row: any) => ReactNode;
}

function expiryCell(v?: string | null) {
  const info = expiryInfo(v);
  const cls: Record<string, string> = {
    ok: 'text-emerald-600',
    warning: 'text-orange-600',
    critical: 'text-amber-600 font-semibold',
    expired: 'text-red-600 font-semibold',
    none: 'text-gray-400',
  };
  return <span className={cls[info.level]}>{info.text}</span>;
}

function MiniTable({ cols, rows, empty = 'Tidak ada data' }: { cols: Col[]; rows: any[]; empty?: string }) {
  if (!rows || rows.length === 0) return <EmptyState message={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-brand-50">
          <tr className="text-left text-[11px] uppercase tracking-wide text-brand-700">
            {cols.map((c) => (
              <th key={c.key} className="px-3 py-2.5 font-bold whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r: any, i: number) => (
            <tr key={r.id ?? i} className="hover:bg-brand-50 transition-colors">
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2.5 whitespace-nowrap">
                  {c.render ? c.render(r) : r[c.key] != null ? String(r[c.key]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  { key: 'daily', label: 'Daily Report', icon: CalendarDays, action: 'daily', needsRange: true, daily: true },
  { key: 'products', label: 'Products', icon: Box, action: 'products', needsRange: false },
  { key: 'inbound', label: 'Inbound', icon: Truck, action: 'inbound', needsRange: true },
  { key: 'outbound', label: 'Outbound', icon: PackageOpen, action: 'outbound', needsRange: true },
  { key: 'stock', label: 'Stock', icon: Boxes, action: 'stock', needsRange: false },
  { key: 'ledger', label: 'Ledger', icon: BookOpen, action: 'ledger', needsRange: true },
];

const DAILY_STOCK_COLS: Col[] = [
  { key: 'product_code', label: 'Kode' },
  { key: 'product_name', label: 'Produk' },
  { key: 'uom_type', label: 'UOM' },
  { key: 'batches', label: 'Batch' },
  { key: 'total_qty', label: 'Total Qty', render: (r) => fmtNum(r.total_qty, 0) },
  { key: 'total_pallet', label: 'Total Pallet', render: (r) => fmtNum(r.total_pallet, 0) },
  { key: 'nearest_expiry', label: 'Exp Terdekat', render: (r) => expiryCell(r.nearest_expiry) },
  {
    key: 'expiring_count',
    label: 'Segera Exp',
    render: (r) =>
      Number(r.expiring_count) > 0 ? (
        <span className="inline-flex px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold">
          {r.expiring_count}
        </span>
      ) : (
        '—'
      ),
  },
];

const INBOUND_ACTIVITY_COLS: Col[] = [
  { key: 'order_number', label: 'Nomor Order' },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  { key: 'order_date', label: 'Tanggal Order', render: (r) => fmtDate(r.order_date) },
  { key: 'received_date', label: 'Tanggal Terima', render: (r) => fmtDate(r.received_date) },
  { key: 'carrier_name', label: 'Carrier' },
  { key: 'item_count', label: 'Items', render: (r) => fmtNum(r.item_count ?? r.total_items ?? r.line_count, 0) },
  { key: 'total_drums', label: 'Total Drums', render: (r) => fmtNum(r.total_drums ?? r.total_qty, 0) },
];

const OUTBOUND_ACTIVITY_COLS: Col[] = [
  { key: 'order_number', label: 'Nomor Order' },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  { key: 'order_date', label: 'Tanggal Order', render: (r) => fmtDate(r.order_date) },
  { key: 'shipment_number', label: 'Shipment' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'item_count', label: 'Items', render: (r) => fmtNum(r.item_count ?? r.total_items ?? r.line_count, 0) },
  { key: 'total_drums', label: 'Total Drums', render: (r) => fmtNum(r.total_drums ?? r.total_qty, 0) },
];

const EXPIRING_COLS: Col[] = [
  { key: 'product_code', label: 'Kode' },
  { key: 'product_name', label: 'Produk' },
  { key: 'batch_number', label: 'Batch' },
  { key: 'location', label: 'Lokasi' },
  { key: 'qty', label: 'Qty', render: (r) => fmtNum(r.qty ?? r.quantity, 0) },
  { key: 'pallet', label: 'Pallet', render: (r) => fmtNum(r.pallet, 0) },
  { key: 'expiry_date', label: 'Expiry', render: (r) => expiryCell(r.expiry_date ?? r.exp_date) },
  {
    key: 'days_until_expiry',
    label: 'Sisa Hari',
    render: (r) =>
      r.days_until_expiry != null ? (
        <span className={Number(r.days_until_expiry) <= 120 ? 'text-amber-600 font-semibold' : 'text-gray-600'}>
          {Number(r.days_until_expiry)} hari
        </span>
      ) : (
        '—'
      ),
  },
];

const LOW_STOCK_COLS: Col[] = [
  { key: 'product_code', label: 'Kode' },
  { key: 'product_name', label: 'Produk' },
  { key: 'location', label: 'Lokasi' },
  { key: 'quantity', label: 'Qty', render: (r) => fmtNum(r.quantity ?? r.qty, 0) },
  { key: 'uom', label: 'UOM' },
  { key: 'pallet', label: 'Pallet', render: (r) => fmtNum(r.pallet, 0) },
  { key: 'reorder_level', label: 'Min. Stok', render: (r) => (r.reorder_level != null ? fmtNum(r.reorder_level, 0) : '—') },
];

const TAB_COLS: Record<string, Col[]> = {
  products: [
    { key: 'product_code', label: 'Kode' },
    { key: 'product_name', label: 'Produk' },
    { key: 'category', label: 'Kategori' },
    { key: 'uom_type', label: 'UOM' },
    { key: 'uom_per_pallet', label: 'UOM/Pallet', render: (r) => fmtNum(r.uom_per_pallet) },
    { key: 'drums_per_pallet', label: 'Drums/Pallet', render: (r) => fmtNum(r.drums_per_pallet) },
    { key: 'total_qty', label: 'Total Qty', render: (r) => fmtNum(r.total_qty, 0) },
    { key: 'total_pallets', label: 'Total Pallet', render: (r) => fmtNum(r.total_pallets, 0) },
  ],
  inbound: INBOUND_ACTIVITY_COLS,
  outbound: OUTBOUND_ACTIVITY_COLS,
  stock: [
    { key: 'product_code', label: 'Kode' },
    { key: 'product_name', label: 'Produk' },
    { key: 'batch_number', label: 'Batch' },
    { key: 'location', label: 'Lokasi' },
    { key: 'quantity', label: 'Qty', render: (r) => fmtNum(r.quantity ?? r.qty, 0) },
    { key: 'uom', label: 'UOM' },
    { key: 'pallet', label: 'Pallet', render: (r) => fmtNum(r.pallet, 0) },
    { key: 'expiry_date', label: 'Expiry', render: (r) => expiryCell(r.expiry_date ?? r.exp_date) },
    { key: 'stock_status', label: 'Status', render: (r) => <StatusBadge status={r.stock_status} /> },
  ],
  ledger: [
    { key: 'transaction_date', label: 'Tanggal', render: (r) => fmtDate(r.transaction_date) },
    { key: 'product_code', label: 'Kode' },
    { key: 'product_name', label: 'Produk' },
    { key: 'transaction_type', label: 'Tipe' },
    { key: 'reference_number', label: 'Referensi' },
    { key: 'batch_number', label: 'Batch' },
    {
      key: 'quantity_in',
      label: 'Masuk',
      render: (r) =>
        Number(r.quantity_in) > 0 ? <span className="text-emerald-600 font-semibold">{fmtNum(r.quantity_in, 0)}</span> : '—',
    },
    {
      key: 'quantity_out',
      label: 'Keluar',
      render: (r) =>
        Number(r.quantity_out) > 0 ? <span className="text-red-500 font-semibold">{fmtNum(r.quantity_out, 0)}</span> : '—',
    },
    { key: 'balance', label: 'Saldo', render: (r) => fmtNum(r.balance, 0) },
    { key: 'uom', label: 'UOM' },
    { key: 'location', label: 'Lokasi' },
  ],
};

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState('daily');
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [reportData, setReportData] = useState<any>(null);
  const [tabData, setTabData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reqId = useRef(0);

  const load = async (tab?: string) => {
    const key = tab ?? activeTab;
    const cfg = TABS.find((t) => t.key === key)!;
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (cfg.needsRange) {
        if (cfg.daily) {
          params.date = fromDate;
          params.date_to = toDate;
        } else {
          params.start_date = fromDate;
          params.end_date = toDate;
        }
      }
      const res = await api('report', cfg.action, { params });
      if (reqId.current !== id) return;
      if (cfg.daily) setReportData(res.report);
      else setTabData((Array.isArray(res.rows) ? res.rows : res) as any[]);
    } catch (e: any) {
      if (reqId.current !== id) return;
      setError(e.message || 'Gagal memuat data');
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const ls = reportData?.ledger_summary || {};
  const ledgerCards = [
    { label: 'Transaksi Masuk', value: ls.transactions_in, icon: ArrowDownToLine, grad: 'from-brand-600 to-brand-400' },
    { label: 'Transaksi Keluar', value: ls.transactions_out, icon: ArrowUpFromLine, grad: 'from-orange-500 to-amber-400' },
    { label: 'Qty Masuk', value: ls.qty_in, icon: PackagePlus, grad: 'from-emerald-600 to-emerald-400' },
    { label: 'Qty Keluar', value: ls.qty_out, icon: PackageMinus, grad: 'from-red-500 to-red-400' },
  ];

  const legacyType = ({ daily: 'daily', stock: 'stock' } as Record<string, string | undefined>)[activeTab];

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Laporan harian & ringkasan data warehouse"
        actions={
          <>
            {legacyType && (
              <>
                <WebBtn
                  href={apiHref('print', 'report', { type: legacyType, date: activeTab === 'daily' ? fromDate : undefined, date_to: activeTab === 'daily' ? toDate : undefined })}
                  label="Print / PDF"
                  icon={<Printer className="w-4 h-4" />}
                />
                <WebBtn
                  href={apiHref('export', 'report', { type: legacyType, date: activeTab === 'daily' ? fromDate : undefined, date_to: activeTab === 'daily' ? toDate : undefined })}
                  label="Export Excel"
                  icon={<FileSpreadsheet className="w-4 h-4" />}
                />
              </>
            )}
            <button
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-white/20 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </>
        }
      />

      <Card>
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="Dari Tanggal" className="w-44">
            <TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          <Field label="Sampai Tanggal" className="w-44">
            <TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Field>
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 bg-brand-600 text-white rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
          >
            <FileText className="w-4 h-4" /> {activeTab === 'daily' ? 'Daily Report' : 'Muat Data'}
          </button>
        </div>
      </Card>

      <div className="flex items-center gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-brand-600'
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>
      )}

      {loading ? (
        <Spinner label="Memuat data..." />
      ) : activeTab === 'daily' ? (
        reportData ? (
          <>
            <div className="text-xs text-gray-500 font-medium mb-4">
              Periode: {fmtDate(fromDate)} — {fmtDate(toDate)}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              {ledgerCards.map((k) => (
                <div key={k.label} className={`rounded-xl bg-gradient-to-br ${k.grad} p-4 text-white shadow-sm`}>
                  <k.icon className="w-4 h-4 opacity-80" />
                  <div className="text-2xl font-extrabold mt-2">{fmtNum(k.value, 0)}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">{k.label}</div>
                </div>
              ))}
            </div>

            <Card title="Stock Summary">
              <MiniTable cols={DAILY_STOCK_COLS} rows={reportData.stock_summary || []} />
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Card title="Inbound Activity">
                <MiniTable cols={INBOUND_ACTIVITY_COLS} rows={reportData.inbound_activity || []} />
              </Card>
              <Card title="Outbound Activity">
                <MiniTable cols={OUTBOUND_ACTIVITY_COLS} rows={reportData.outbound_activity || []} />
              </Card>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Card title="Expiring Items">
                <MiniTable cols={EXPIRING_COLS} rows={reportData.expiring_items || []} />
              </Card>
              <Card title="Low Stock">
                <MiniTable cols={LOW_STOCK_COLS} rows={reportData.low_stock || []} />
              </Card>
            </div>
          </>
        ) : (
          <EmptyState message="Klik tombol Daily Report untuk membuat laporan" />
        )
      ) : (
        <Card title={TABS.find((t) => t.key === activeTab)?.label}>
          <MiniTable cols={TAB_COLS[activeTab] || []} rows={tabData} />
        </Card>
      )}
    </div>
  );
}
