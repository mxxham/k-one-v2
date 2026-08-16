import { FormEvent, useEffect, useState } from 'react';
import { Search, RefreshCw, ArrowDownToLine, ArrowUpFromLine, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';

import Spinner from '@/components/Spinner';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, Select } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { fmtNum, fmtDateTime } from '@/lib/format';

interface LedgerRow {
  id: number;
  transaction_date: string;
  product_code: string;
  product_name: string;
  transaction_type: string;
  reference_type: string;
  reference_number: string;
  batch_number: string;
  quantity_in: number;
  quantity_out: number;
  uom: string;
  pallet: number;
  balance: number;
  location: string;
  notes: string;
  created_at: string;
}

const LIMIT_OPTIONS = [50, 100, 200, 500, 1000];

function typeBadge(t: string) {
  const up = (t || '').toUpperCase();
  let cls = 'bg-gray-100 text-gray-600 border-gray-300';
  if (up.includes('TRANSFER')) cls = 'bg-blue-50 text-blue-700 border-blue-300';
  else if (up.includes('ADJUST')) cls = 'bg-amber-50 text-amber-700 border-amber-300';
  else if (up.includes('OUT')) cls = 'bg-red-50 text-red-700 border-red-300';
  else if (up.includes('IN')) cls = 'bg-green-50 text-green-700 border-green-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${cls}`}>
      {t || '—'}
    </span>
  );
}

export default function LedgerPage() {
  const toast = useToast();
  const { canAdmin } = useAuth();

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [productId, setProductId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [limit, setLimit] = useState('200');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api('ledger', 'list', {
        params: { product_id: productId, start_date: startDate, end_date: endDate, limit },
      });
      setRows((res.rows || []) as LedgerRow[]);
      setProducts(res.products || []);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat ledger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = (e: FormEvent) => {
    e.preventDefault();
    load();
  };

  const reset = () => {
    setProductId('');
    setStartDate('');
    setEndDate('');
    setLimit('200');
    setTimeout(load, 0);
  };

  const repairAll = async () => {
    try {
      await api('ledger', 'repair_all', { method: 'POST' });
      toast('success', 'Ledger berhasil diperbaiki');
      load();
    } catch (e: any) {
      toast('error', e.message || 'Gagal memperbaiki ledger');
    }
  };

  const totalIn = rows.reduce((s, r) => s + (Number(r.quantity_in) || 0), 0);
  const totalOut = rows.reduce((s, r) => s + (Number(r.quantity_out) || 0), 0);

  return (
    <div>
      <PageHeader
        title="Stock Ledger"
        subtitle="Riwayat transaksi mutasi stok"
        actions={
          <>
            <WebBtn
              href={apiHref('export', 'ledger')}
              label="Export Excel"
              tone="dark"
              icon={<FileSpreadsheet className="w-4 h-4" />}
            />
            {canAdmin ? (
              <ConfirmButton
                label="Repair All Ledger"
                confirmText="Perbaiki seluruh data ledger? Saldo akan dihitung ulang."
                onConfirm={repairAll}
              />
            ) : undefined}
          </>
        }
      />

      <div className="flex flex-wrap gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
            <ArrowDownToLine className="w-4 h-4" />
          </span>
          <div>
            <div className="text-lg font-bold text-brand-900">{fmtNum(totalIn, 0)}</div>
            <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">Total Masuk</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
            <ArrowUpFromLine className="w-4 h-4" />
          </span>
          <div>
            <div className="text-lg font-bold text-brand-900">{fmtNum(totalOut, 0)}</div>
            <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">Total Keluar</div>
          </div>
        </div>
      </div>

      <Card title="Filter">
        <form onSubmit={handleApply} className="flex flex-wrap items-end gap-3">
          <div className="w-full md:w-64">
            <Field label="Produk">
              <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Semua Produk</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.product_code, p.product_name].filter(Boolean).join(' — ')}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Dari Tanggal">
              <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Sampai Tanggal">
              <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Limit">
              <Select value={limit} onChange={(e) => setLimit(e.target.value)}>
                {LIMIT_OPTIONS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex gap-2 pb-0.5">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 inline-flex items-center gap-2"
            >
              <Search className="w-4 h-4" /> Terapkan
            </button>
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200 inline-flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Reset
            </button>
          </div>
        </form>
      </Card>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 bg-brand-50/50 flex items-center justify-between">
          <h3 className="font-bold text-sm text-brand-700">
            Transaksi {rows.length > 0 && <span className="text-gray-400 font-medium">({rows.length})</span>}
          </h3>
        </div>
        {loading ? (
          <Spinner label="Memuat ledger…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Tidak ada data transaksi" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 text-left font-bold">Tanggal</th>
                  <th className="px-3 py-2.5 text-left font-bold">Produk</th>
                  <th className="px-3 py-2.5 text-left font-bold">Tipe</th>
                  <th className="px-3 py-2.5 text-left font-bold">Ref Type</th>
                  <th className="px-3 py-2.5 text-left font-bold">Ref No</th>
                  <th className="px-3 py-2.5 text-left font-bold">Batch</th>
                  <th className="px-3 py-2.5 text-right font-bold">Masuk</th>
                  <th className="px-3 py-2.5 text-right font-bold">Keluar</th>
                  <th className="px-3 py-2.5 text-left font-bold">UOM</th>
                  <th className="px-3 py-2.5 text-right font-bold">Saldo</th>
                  <th className="px-3 py-2.5 text-left font-bold">Lokasi</th>
                  <th className="px-3 py-2.5 text-left font-bold">Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-brand-50/50">
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{fmtDateTime(r.transaction_date)}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-brand-800">{r.product_code}</div>
                      <div className="text-xs text-gray-500">{r.product_name}</div>
                    </td>
                    <td className="px-3 py-2.5">{typeBadge(r.transaction_type)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.reference_type || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.reference_number || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.batch_number || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600 font-semibold">
                      {r.quantity_in ? fmtNum(r.quantity_in, 0) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-red-600 font-semibold">
                      {r.quantity_out ? fmtNum(r.quantity_out, 0) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{r.uom || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{fmtNum(r.balance, 0)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-700">{r.location || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500 max-w-[160px] truncate" title={r.notes || ''}>
                      {r.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
